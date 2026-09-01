---
title: "Compaction"
slug: compaction
brief: "SSTable 越積越多，定期合併成大檔案並丟掉舊版本。"
date: 2026-09-01
article: compaction-merge
---

# Compaction

> [LSM Tree](chunk://lsm-tree) 的背景整理工作。Cassandra 叫 compaction，ClickHouse 叫 merge，Lucene 也叫 merge。

## 為什麼需要

[LSM Tree](chunk://lsm-tree) 的 SSTable 寫完就不再修改。UPDATE 寫一份新版本進新檔案，DELETE 寫一個 tombstone 進新檔案。同一個 key 因此散在很多檔案裡：

```
SSTable-001:  user_id=8821, name="Alice",   email="a@x.com",  ts=T1
SSTable-014:  user_id=8821, name="Alice_2",                   ts=T2   ← 只改了 name
SSTable-039:  user_id=8821, tombstone（整列刪除）              ts=T3
```

UPDATE 只寫被改到的欄位，衝突解決是逐欄位比 writetime，所以讀一整列不能停在最新的那個檔案。這裡的 name 在 014，email 還留在 001。可能含這個 partition 的 SSTable 都要打開，逐欄位挑出最新的再拼回來。檔案數量沒有上限，每個檔案還各自帶一份 index 跟 [bloom filter](chunk://bloom-filter) 常駐記憶體。所以要定期把多個 SSTable 合併成一個，同一個欄位只保留 writetime 最大的版本，tombstone 整組丟掉。

## 怎麼合併

每個 SSTable 內部已經按 key 排好序，合併之後也要保持有序。做法是 k-way merge。每個檔案的最前面那筆放進一個 min heap，pop 出最小的寫進新檔案，再從它原本那個檔案取下一筆補進 heap。

```
A: 1, 4, 9      heap: {1(A), 2(B), 3(C)}  → pop 1，A 補 4 進來
B: 2, 5               {2(B), 3(C), 4(A)}  → pop 2，B 補 5 進來
C: 3, 8               {3(C), 4(A), 5(B)}  → pop 3 ...

輸出: 1, 2, 3, 4, 5, 8, 9
```

N 筆資料、k 個檔案，時間 O(N log k)，演算法的空間 O(k)。檔案用 streaming 讀取，不需要整份載入（行程實際佔的記憶體另外還有讀寫緩衝跟正在建的 bloom filter，那些跟 N 走）。這也是 merge k sorted lists 的解法（LeetCode 第 23 題：給 k 條各自遞增的 list，合成一條遞增的）。差別在語意，那題的重複值兩個都要輸出，compaction 的重複 key 只能留一份。

tombstone 沒那麼容易丟。跨節點要熬過 `gc_grace_seconds`（預設十天），不然 tombstone 先消失、另一個副本還沒收到刪除指令，read repair 就把舊資料同步回來了。本機這邊還要求這一輪 compaction 涵蓋所有含更舊資料的 SSTable，不然丟掉 tombstone 之後，沒被涵蓋的那個檔案裡的舊資料就冒出來。後面這條直接決定策略要怎麼挑檔案。

## 三種策略

挑哪幾個檔案合併，決定了讀、寫、空間三邊的成本怎麼分配，也決定 tombstone 清得掉還是卡住。

| 策略 | 規則 | 好在哪 | 代價 |
|---|---|---|---|
| STCS（SizeTiered，預設）| 大小相近的湊滿 `min_threshold`（預設 4）個觸發，一輪最多吃 `max_threshold`（預設 32）個 | 總寫放大是個位數，每升一個尺寸級距才重寫一次，級距數的底就是合併寬度 | 舊版本留在大檔案裡很久，磁碟浪費多，讀取要開的檔案數不確定，tombstone 涵蓋不到大檔案裡的舊資料所以清不掉 |
| LCS（Leveled）| 每層檔案固定 160MB，L1 以上同層 key range 不重疊 | 查一個 key，L1 以上每層最多讀一個檔案 | 總寫放大幾十倍，每層最壞等於 fanout（預設 10）再累加。L0 不保證不重疊，可以累到 32 個才觸發自己那輪 STCS，compaction 追不上時讀取要開的檔案數比 STCS 還多 |
| TWCS（TimeWindow）| 按時間窗切分，窗關閉後不再跟別的窗合併 | 整窗到期可以丟掉整份 SSTable，不用 merge | 只適用於按時間 append、且靠 TTL 到期的資料；用排程 DELETE 的話 tombstone 落在新窗、資料在舊窗，兩邊永遠碰不到。而且到期不等於馬上丟，`gc_grace_seconds` 照算，還要確認這份沒蓋住別份的資料 |

寫放大（write amplification）指一筆資料從寫入到最終落定，總共被重寫幾次。LSM 用它換 sequential write，compaction 策略決定要換多少。
