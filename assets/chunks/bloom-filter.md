---
title: "Bloom Filter"
slug: bloom-filter
brief: "Bloom filter 花極小記憶體判斷「一定不存在」，不存在的直接擋，不用查磁碟。"
date: 2026-03-21
updated: 2026-07-20
revisions: 2
---

# Bloom Filter

> 用極少的記憶體判斷「這個東西一定不在」。用在 LSM-tree、CDN、爬蟲 URL dedup、Chrome 安全瀏覽。

## 問題

LSM-tree 讀取一筆資料時，不知道它在哪個 SSTable。最笨的方法是從新到舊把每個 SSTable 都打開查一遍。10 個 SSTable 就是 10 次磁碟讀取。如果那筆資料根本不存在，10 次全白跑。

能不能在打開 SSTable 之前，先問一句：「這個 key 有沒有可能在裡面？」

## 一個 bit array + 幾個 hash function

Bloom filter 是一個長度為 m 的 bit array，初始全部是 0。搭配 k 個 hash function。

### 新增

把 key 丟進 k 個 hash function，每個算出一個位置，把那些位置的 bit 設為 1。

```text
新增 "user-42"（k=3, m=10）

hash_1("user-42") = 2
hash_2("user-42") = 5
hash_3("user-42") = 8

index:      0  1  2  3  4  5  6  7  8  9
bit array: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0]
```

再新增 "user-77"：

```text
hash_1("user-77") = 1
hash_2("user-77") = 5  ← 跟 user-42 的 hash_2 撞了
hash_3("user-77") = 9

index:      0  1  2  3  4  5  6  7  8  9
bit array: [0, 1, 1, 0, 0, 1, 0, 0, 1, 1]
```

### 查詢

把 key 丟進同樣的 k 個 hash function，檢查對應的 bit 是不是全部都是 1。

```text
查 "user-42"：位置 2, 5, 8 → 全部是 1 → 可能存在
查 "user-99"：位置 3, 5, 7 → 位置 3 是 0 → 一定不存在
```

**一定不存在**：只要任何一個位置是 0，這個 key 絕對沒被加過。
**可能存在**：全部是 1 也不代表加過。可能是其他 key 的 hash 剛好把這些位置都設成了 1。這就是 false positive。

### 不能刪除

把某個 key 對應的 bit 設回 0？不行。因為那些 bit 可能是其他 key 設的。設回 0 會讓其他 key 產生 false negative（明明存在卻說不存在），比 false positive 更糟。

需要刪除功能就用 Counting Bloom Filter：每個位置不存 0/1，存一個計數器。新增 +1，刪除 -1。代價是記憶體用量增加。

## False Positive Rate

bit array 越長（m 越大），hash function 越多（k 越多，但有上限），false positive rate 越低。

```text
m = 10 bit per key, k = 7  → false positive rate ≈ 0.8%
m = 5 bit per key, k = 3   → false positive rate ≈ 10%
m = 20 bit per key, k = 14 → false positive rate ≈ 0.01%
```

10 bit per key 是常見配置。100 萬個 key 只需要 1.2 MB 的 bit array，false positive rate 不到 1%。換成 hash set 存 100 萬個 key 至少要幾十 MB。

## 為什麼快：RAM vs SSD

Bloom filter 活在 RAM 裡。查一次 bloom filter 是記憶體操作，查 DB 是磁碟 + 網路操作。速度差距：

```text
RAM 存取：   ~100 ns（奈秒）
SSD 存取：   ~100 μs（微秒）= 慢 1,000 倍
DB 查詢（SSD + 網路 + 解析）：~1-10 ms = 慢 10,000-100,000 倍
```

1,000 萬個 key 的 bloom filter 只佔 1.2 MB RAM。用極少的記憶體擋掉大量不必要的磁碟查詢。

## 在 LSM-tree 裡怎麼用

每個 SSTable 建立時，把它包含的所有 key 塞進一個 bloom filter，存在 SSTable 的 metadata 裡。

```text
讀取 key="user-42"
  → 查 SSTable_5 的 bloom filter → "一定不在" → 跳過
  → 查 SSTable_4 的 bloom filter → "一定不在" → 跳過
  → 查 SSTable_3 的 bloom filter → "可能在" → 打開 SSTable_3 查找
  → 找到了
```

10 個 SSTable，bloom filter 幫忙跳過 8 個，只需要打開 2 個。原本 10 次磁碟 IO 變成 2 次。

RocksDB 預設每個 SSTable 都帶 bloom filter。Cassandra 也是。

## 其他用途

**爬蟲 URL dedup**：爬過的 URL 放進 bloom filter。新 URL 先查 bloom filter，「一定沒爬過」才排入佇列。偶爾重複爬一次（false positive）不影響結果，但省掉大量重複請求。

**CDN 快取策略**：第一次請求不快取（可能是一次性流量）。用 bloom filter 記錄看過的 URL，第二次出現才放進快取。Akamai 用這個方法，避免一次性流量汙染快取。

**Chrome 安全瀏覽**：Google 維護一份惡意 URL 列表。Chrome 不可能每次開網頁都去 Google 查。把列表壓成 bloom filter 放在本地，「可能是惡意」才去 server 確認。

## 實際怎麼用

大部分語言有現成的 library，給兩個參數就能用：預計放多少個 key（capacity）、可接受的 false positive rate（error_rate）。Library 自動算出 bit array 大小和 hash function 數量。

```python
# Python — pybloom-live
from pybloom_live import BloomFilter

bf = BloomFilter(capacity=10_000_000, error_rate=0.01)

bf.add("Xk9mP2q")

"Xk9mP2q" in bf  # True（可能存在）
"fakeKey" in bf   # False（一定不存在）
```

```text
常見 library：
  Java:    Google Guava BloomFilter
  Go:      github.com/bits-and-blooms/bloom
  Python:  pybloom-live
  Redis:   RedisBloom module（BF.ADD / BF.EXISTS）
```

**RedisBloom vs 原生 Redis**：原生 Redis 沒有 bloom filter，只有基本的 key-value。RedisBloom 是一個 module（外掛），裝上去之後 Redis 多了 `BF.ADD`、`BF.EXISTS` 這些指令。好處是 bloom filter 跟著 Redis 一起持久化，重啟不用從 DB 重建。不裝 RedisBloom 的話，bloom filter 只能放在 application 的記憶體裡，重啟就沒了。Redis 怎麼把 RAM 裡的資料存到磁碟（RDB / AOF），拆在 [Redis Persistence](chunk://redis-persistence)。

---

Bloom filter 用極少記憶體換取「一定不存在」的保證。False positive 可以容忍，false negative 不能。在 LSM-tree 裡，它省掉大量無效的磁碟讀取。
