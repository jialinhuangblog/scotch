---
title: "資料放 CPU cache 還是放磁碟，拿到的快慢差好幾個數量級"
slug: latency-hierarchy
subtitle: "從 CPU L1 cache 到跨洲 RTT，9 個量級的延遲階層"
chapter: "buffer"
tags: [cache, latency, performance]
date: 2026-05-03
updated: 2026-06-11
revisions: 1
related: [cache-hot-key, db-connections, packet-journey, search-cache]
---

# 資料放 CPU cache 還是放磁碟，拿到的快慢差好幾個數量級

從 RAM 拿一筆資料：**100 奈秒**。  
從 SSD 拿同一筆：**100 微秒**。  
從硬碟拿同一筆：**10 毫秒**。  
從跨洲伺服器拿同一筆：**150 毫秒**。

同一筆資料，最慢比最快大概差一百萬倍。差別只在它躺在哪一層。

這篇講「**所有可能的層**」跟「每層差幾倍」。Redis、CDN、cache hit/miss 這些下游話題的前置作業。

---

## 時間單位先攤平

談延遲前先把單位釘死。每階差 1000 倍：

```
1 秒 (s)    = 1
1 毫秒 (ms)  = 10^-3 秒
1 微秒 (μs)  = 10^-6 秒
1 奈秒 (ns)  = 10^-9 秒
```

換算捷徑：

```
1 秒 = 1000 毫秒 = 1,000,000 微秒 = 1,000,000,000 奈秒
```

下面所有數字用這四個單位。看到 100 ns、100 μs、100 ms，記得它們相差 1000 倍，不是 100 倍。

---

## 硬體階層

從上到下：越快、越小、越貴 → 越慢、越大、越便宜。

| 層 | 延遲 | 換成秒 | 容量 |
|---|---|---|---|
| CPU 暫存器 | ~1 ns | 0.000000001 秒 | 幾 byte |
| L1 cache | ~1 ns | 0.000000001 秒 | 32 KB |
| L2 cache | ~4 ns | 0.000000004 秒 | 256 KB ~ 1 MB |
| L3 cache | ~10 ns | 0.00000001 秒 | 幾 MB ~ 幾十 MB |
| RAM (DRAM) | ~100 ns | 0.0000001 秒 | GB 級 |
| NVMe SSD | ~10 μs | 0.00001 秒 | TB 級 |
| SATA SSD | ~100 μs | 0.0001 秒 | TB 級 |
| HDD（磁碟） | ~10 ms | 0.01 秒 | TB 級 |

**每層差 10 ~ 100 倍**：

| 比較 | 差幾倍 |
|---|---|
| L1 vs RAM | 100 倍 |
| RAM vs SSD | 100 倍 |
| SSD vs HDD | 100 倍 |
| RAM vs HDD | 100,000 倍 |

其他條件差不多的話，RAM 比 HDD 大概快十萬倍，記住這個量級就好。後面 in-memory vs disk 的事都從這裡來。

---

## 網路階層

跨機器拿資料，光速是上限：

| 距離 | RTT（往返） | 換成秒 |
|---|---|---|
| 同一機架（Rack） | ~100 μs | 0.0001 秒 |
| 同機房跨機架 | ~500 μs | 0.0005 秒 |
| 同城跨機房 | ~5 ms | 0.005 秒 |
| 跨城（同國內） | ~30 ms | 0.03 秒 |
| 跨洲（亞洲 ↔ 美洲） | ~150 ms | 0.15 秒 |

**為什麼跨洲一定要 100 ms 以上**：地球周長約 4 萬公里，真空光速 30 萬公里/秒，繞一圈是 `40000 ÷ 300000 ≈ 133 ms`。地表最遠的兩點來回剛好是這一圈，這是真空下的絕對下限。實際上光纖裡光速只剩真空的約 2/3（折射率 ~1.5），海底電纜又不走直線，所以跨洲實測約 100~180 ms。光速是底，沒有網路技術能突破。

「**RAM 一次比跨洲網路快大概一百萬倍**」（100 ns vs 150 ms）。所以跨地理的應用不能即時讀對岸 DB，**必須有本地 cache**。

---

## 應用層 cache

把硬體 + 網路階層接上應用設計，從快到慢排：

| 層 | 延遲 | 換成秒 | 在哪 |
|---|---|---|---|
| Browser cache | 0 | 0 秒 | 客戶端 |
| App in-process cache（LRU map） | ~100 ns | 0.0000001 秒 | 程式自己的記憶體 |
| Redis / Memcached | ~1 ms | 0.001 秒 | 隔壁機器，網路 + RAM |
| Reverse proxy（Varnish, Nginx） | ~1 ms | 0.001 秒 | 機房入口 |
| DB query cache | ~5 ms | 0.005 秒 | DB 自己 |
| CDN 邊緣節點 | ~10 ms | 0.01 秒 | 離使用者最近的機房 |
| DB（讀 SSD） | ~10 ms | 0.01 秒 | DB 機器的硬碟 |
| DB（讀 HDD） | ~30 ms | 0.03 秒 | 老舊 DB |

---

## 完整路徑

一個 HTTP 請求的快取階層：

```
使用者
  ↓ 50~150 ms（網路 RTT）
CDN ←───── 命中就回（10 ms）
  ↓ 沒命中
Server（同機房）
  ↓ 100 ns（in-process cache）
本機 RAM ←─ 命中就回
  ↓ 沒命中
Redis（跨機器）
  ↓ 1 ms
Redis RAM ←── 命中就回
  ↓ 沒命中
DB
  ↓ 10 ms（讀 SSD）
DB SSD ←── 真正的資料源
```

每層問題：**先問自己有沒有，沒有才往下問**。找到後**寫回上層**，下次同樣的請求直接命中。

---

## 為什麼這樣設計

**80/20 法則**：80% 的請求集中在 20% 的熱資料。

```
熱資料（小、頻繁）→ 放上層（小、快、貴）
冷資料（大、稀少）→ 放下層（大、慢、便宜）
```

容量跟速度天生衝突：

- 上層越快越小（L1 才 32 KB）→ 只能放最熱的
- 下層越大越慢（HDD 動輒 TB）→ 全部資料都在這

cache 就是條捷徑。東西熱門的話，不用每次都讓後面的層忙著找，前面先放著，這裡就先幫忙消化請求。

---

## 一個實際的例子

「全球用戶讀同一張產品圖片，怎麼設計？」

```
壞設計：
  全球用戶 → 直連美國機房 DB → 讀圖
  ↓
  亞洲用戶每張圖等 150 ms

好設計：
  圖片放 S3
  S3 + CloudFront（CDN）
  亞洲用戶 → 東京邊緣節點（10 ms）
  歐洲用戶 → 法蘭克福邊緣節點（10 ms）
  ↓
  每個地區延遲降到 10 ms
```

差別在「**把資料推到使用者最近的層**」。CDN 做的就是把熱資料複製到全世界的邊緣機房。

---

## 跟 Big-O 的關係

寫 LeetCode 時你假設「全部資料在 RAM」，所以只算 Big-O 不管常數。

**真實系統裡，資料躺在哪一層差很多**：

- 同樣 O(N)，掃 RAM 跟掃 HDD 速度差 10 萬倍
- cache miss 一次 = 多走 100 ns
- 要估 throughput / latency，第一個要問的永遠是**「資料在哪一層」**

例：「O(1) 的 hashmap 查詢」聽起來很快，但如果這個 hashmap 是分散式 Redis 在另一個機房，**一次查詢 5 ms**。同一段邏輯在 in-process 是 100 ns。**差 5 萬倍**，Big-O 看不出來。

---

## 接下來

理解這層階層後，cache 系列的所有討論都有了背景：

- **[Cache 雪崩 / 穿透 / 擊穿](article://cache-hot-key)**：為什麼 cache 沒擋住，DB 直接被打掛
- **[Cache eviction](chunk://cache-eviction)**：上層放不下，要把誰踢出去（LRU、LFU）
- **[Cache strategies](chunk://cache-strategies)**：write-through / write-behind / cache-aside，誰先寫誰後寫
- **[CDN caching](chunk://cdn-caching)**：怎麼把資料推到邊緣
- **[DB connections](article://db-connections)**：為什麼 DB 連線池要小心管
- **[Packet journey](article://packet-journey)**：網路那 100 ms 是怎麼花掉的

每篇都假設你已經知道「**為什麼 cache 重要**」。這篇是那個「為什麼」。

---

## References

- [Latency Numbers Every Programmer Should Know](https://gist.github.com/jboner/2841832) — RAM ~100 ns、disk seek ~10 ms，單筆隨機存取 RAM 比 HDD 快約十萬倍；跨洲來回 ~150 ms，RAM 比它快約一百五十萬倍（文中取整講成百萬倍）。這些是「延遲、單筆隨機」的比法。若是順序搬一大塊資料，看的是頻寬，差距小得多（同來源：順序讀 1 MB，記憶體 250 μs vs 磁碟 20 ms，約 80 倍）。原始為 2012 基準，量級關係至今成立。
- [3D XPoint / Intel Optane](https://en.wikipedia.org/wiki/3D_XPoint) — DRAM 跟 SSD 中間曾有「持久記憶體」（Storage-Class Memory）想補位：Optane 做成插在記憶體插槽的 DIMM 時，延遲只比 DRAM 高約一個量級、又斷電不丟資料，但 Intel 在 2021–2022 年把它收掉。現在接棒補這層的方向是 CXL 這種新匯流排。一般 NVMe SSD 掛在 PCIe 後面，延遲停在微秒級，追不到 RAM 的奈秒級。
