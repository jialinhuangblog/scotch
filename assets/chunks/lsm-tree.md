---
title: "LSM Tree"
slug: lsm-tree
brief: "寫入優化。RocksDB、Cassandra、LevelDB 都用。"
date: 2026-03-15
updated: 2026-09-01
revisions: 4
article: compaction-merge
---

# LSM Tree（Log-Structured Merge-Tree）

> 通用概念。RocksDB、Cassandra、LevelDB、ClickHouse 用。MySQL（InnoDB）和 PostgreSQL 不用，它們用 B+ Tree。

## B+ Tree 寫入的弱點

B+ Tree 的寫入速度取決於 key 是否單調遞增、有沒有 secondary index、以及那筆是 INSERT 還是 UPDATE。

| 情境 | B+ Tree 寫入 | LSM Tree 寫入 |
|---|---|---|
| Auto-increment PK、無 secondary index | sequential（append 最右 leaf）| sequential |
| UUID PK | random | sequential |
| 有 secondary index | random（secondary 那邊）| sequential |
| UPDATE 既有 row | random | sequential（寫新版本）|

B+ Tree 的最佳情況可以打平 LSM，但實務上 schema 幾乎都有 secondary index，這個情境就不成立。LSM 的賣點是 **key 模式不論怎麼變，永遠是 sequential write**。

Buffer pool 會救一部分，B+ Tree DB 先改 RAM 裡的 page，背景再批次刷回 SSD，攤平 random IO 成本。但當寫入超過 buffer pool 的吸收能力，random write 的代價就浮現。

## LSM Tree 的做法

先全部丟進記憶體，攢夠了一次性 sequential 寫到磁碟。

```text
Client 寫入
  → 1. 先寫 WAL（sequential append，斷電保險）
  → 2. 寫進 Memtable（RAM 裡的 sorted 結構）
  → 3. Memtable 滿了 → flush 成一個 SSTable 檔案存到磁碟
```

**Memtable**：RAM 裡的 skip list，key 有序，斷電就沒，靠 WAL 保險。

**SSTable**（Sorted String Table）：Memtable flush 到磁碟產生的實體檔案（`.sst`），key 有序，immutable。

RAM 存取 ~100 ns，SSD ~50 μs，差 500 倍。LSM 用 RAM 的速度接住寫入，用 SSD 的持久性保證不丟。

<details>
<summary><strong>完整 17 步驟：每個環節在 RAM 還是 SSD（點開看細節）</strong></summary>

把寫入、flush、讀取、compaction 四條路徑拆開，每一步標記位置。CPU cache 不出現在這張圖，它是 RAM 存取的硬體加速，不是獨立的儲存層。

### 寫入路徑

```text
[1] Client 發送 PUT key=X, value=Y
    位置: Network → DB process 的 socket buffer [RAM]

[2] DB process 解析請求
    位置: 函式區域變數 [RAM heap/stack]

[3] 寫 WAL (write-ahead log)
    位置: [SSD] — append 到 wal.log 尾端
    動作: write() + fsync()，sequential write ~10μs
    用途: 斷電保險。memtable 丟了可以 replay WAL 重建

[4] 寫 Memtable
    位置: [RAM] — DB process heap 裡的 skip list
    動作: 類似 map.set(key, value)，~100ns

[5] 回覆 Client: 寫入成功
    位置: [RAM → Network]
```

步驟 3-4 是核心。WAL 在 SSD，斷電不丟；Memtable 在 RAM，夠快。兩個一起構成「既快又不丟」的組合。

### Flush 路徑

```text
[6] Memtable 超過門檻（例如 64MB）→ 凍結它
    動作: 建一個新的空 memtable 接後續寫入

[7] 背景 thread 把凍結的 memtable flush 成 SSTable
    從: [RAM]（凍結的 memtable）
    到: [SSD]（產生 SSTable_001.sst）
    動作: 遍歷 skip list（已有序），sequential write 整個檔案

[8] Flush 完成 → WAL 可以清掉
    位置: [SSD] truncate wal.log
```

### 讀取路徑

```text
[9] Client 發送 GET key=X
    位置: [Network → RAM]

[10] 查 Memtable（最新資料）
     位置: [RAM]，skip list 查找 ~100ns
     結果: 找到 → 直接回傳；沒找到 → 繼續

[11] 從新到舊掃描 SSTable
     對每個 SSTable:
       a. 查 Bloom filter [RAM]
          - 說「不存在」→ 跳過這個 SSTable，0 次 IO
          - 說「可能存在」→ 往下
       b. 查 SSTable 的 index block
          - 可能在 [RAM] (block cache) 或 [SSD]
       c. 讀對應的 data block
          - 在 block cache [RAM] → 快
          - 從 SSD 讀 → ~50μs

[12] 回傳結果
     位置: [RAM → Network]
```

### Compaction（背景整理）

```text
[13] 背景 thread 偵測到 SSTable 太多 → 選幾個準備合併

[14] 讀取要合併的 SSTable
     從: [SSD]（多個 .sst 檔案）
     到: [RAM]（streaming 讀，不一次全載）

[15] 合併：同一個 key 只留最新版本，丟掉 tombstone
     位置: [RAM] 處理

[16] 寫出新的 SSTable
     從: [RAM] → [SSD]，sequential write

[17] 刪除舊的 SSTable
     位置: [SSD]
```

### 每個元件的位置對照

| 元件 | 位置 | 角色 |
|---|---|---|
| Memtable | **RAM** | 接住寫入的有序 skip list |
| WAL | **SSD** | Memtable 的斷電保險，append only |
| SSTable | **SSD** | 持久化的不可變檔案 |
| Bloom filter | **RAM**（跟著 SSTable 載入）| 快速判斷 key 一定不在 |
| SSTable index block | **RAM**（block cache）或 **SSD** | 定位 data block |
| SSTable data block | **RAM**（block cache）或 **SSD** | 真正的 key-value |
| Block cache | **RAM** | LRU 快取，減少 SSD 讀取 |

寫入路徑 = RAM (memtable) + SSD (WAL)，其他一切都在 SSD。RAM 是工作區，SSD 是倉庫。

</details>

## 刪除怎麼辦

SSTable 是 immutable，不能打開檔案把某一行刪掉。所以 DELETE 不是真的刪資料，而是寫入一個 **tombstone**（墓碑標記）：「這個 key 已經被刪了」。

讀取時看到 tombstone 就知道這筆資料不存在了。等之後整理（compaction）時才真正丟掉。

## 讀取：代價在這裡

寫入快了，但讀取變慢了。一筆資料可能在 memtable 裡，也可能在最近的 SSTable，也可能在很舊的 SSTable。要從新到舊一個一個找。

**Bloom filter** 能加速。每個 SSTable 附帶一個 bloom filter，可以快速判斷「這個 key 一定不在這個 SSTable 裡」。跳過不可能有的 SSTable，省掉大量無效讀取。

## Block Cache：讀取的 LRU 加速

SSTable 由很多 **block** 組成（4 KB ~ 64 KB 一個）。讀取從 SSD 拉一個 block 進 RAM 時，LSM 把這個 block 放進 **block cache**（LRU），下次查附近的 key 就不用再跑 SSD。利用的是局部性原理，剛讀了 key=X，接下來很可能讀附近的 key=Y。

Block cache 和 memtable 都在 RAM，但角色不同：

| | Memtable | Block Cache |
|---|---|---|
| 內容 | 最近寫入的新資料 | 從 SSTable 讀出來的熱副本 |
| Source of truth | 是（flush 前）| 否（可重新從 SSTable 讀）|
| 滿了 | Flush 成 SSTable | LRU 淘汰 |

Block cache 是 DB 引擎內部的優化（RocksDB 自動管理），跟你在應用層自己用的 Redis 是不同層的東西。Redis 管「跨 server 共用的熱資料」，block cache 管「單一 DB 實例內的熱 block」。

## Compaction：整理磁碟

SSTable 越來越多，讀取就越來越慢（要掃的檔案越來越多）。[Compaction](chunk://compaction) 把多個 SSTable 合併成一個，丟掉舊版本和 tombstone。

類似整理書桌。便條紙散了一桌，定期把它們合併成一本筆記本，丟掉過期的。

合併的做法是 k-way merge。每個 SSTable 內部已經有序，各取最前面一筆放進 min heap，pop 最小的寫出去再從那個檔案補一筆。時間 O(N log k)，演算法的空間只有 k 筆。

---

B+ Tree 的寫入在 auto-increment PK + 無 secondary index 的最佳情況下也是 sequential，但真實 schema 幾乎不可能滿足這個條件。LSM 把寫入**穩定地**變成 sequential，代價是讀取要多查幾個地方。OLTP（MySQL、PostgreSQL）選 B+ Tree，寫入密集的場景（RocksDB、Cassandra）選 LSM。
