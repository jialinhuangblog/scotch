---
title: "設了一個很沒意義、用不太到的 cache"
slug: search-cache
subtitle: "從 naive cache 到 production，normalize / canonical / multi-tier 是分水嶺。"
chapter: "search"
tags: [cache, search, redis]
date: 2026-04-28
related: [search-geo, cache-hot-key, wishlist-dataloader]
---

# 設了一個很沒意義、用不太到的 cache

上一篇講 [search 主架構](article://search-geo)：Postgres + ES + CDC。系統規模大了，下一個壓力點是 cache：popular query 該不該每次都打 ES？

直覺答：當然 cache。但 cache 的關鍵不在「設不設」，在「**設了之後命中率是多少**」。

這題很容易栽。設了 5 個維度的 cache key，hash 起來當 Redis key，TTL 60 秒，聽起來對。**但這種 key 幾乎不會重複兩次，命中率低到等於沒設過 cache**。

這篇拆 cache key 設計的真相。本文用 Airbnb search 當載體，結論可以直接套到 Twitter feed、YouTube metadata、Uber matching、URL shortener。

---

## 為什麼 search cache 沒那麼簡單

很多系統規模一大，最後都繞到「**cache 怎麼設計**」這題：

| 系統 | 同樣的 cache key 問題 |
|---|---|
| Twitter feed | timeline cache 該 cache 多細？ |
| YouTube | video metadata cache key 怎麼設？ |
| URL shortener | hot URL 的 cache 策略？ |
| Uber matching | driver location cache 怎麼分區？ |
| Airbnb search | search result cache（本篇） |

「加 Redis cache 就好」是直覺答案。難的是「設了 cache 不一定有用」這層認知。

---

## 兩層 cache：ES 內建 vs Application

### Layer 1：ES 內建（自動，但對 popular query 幫不太上）

ES 自己有 4 層 cache：

| Cache | 做什麼 | 對 popular query 幫助 |
|---|---|---|
| **Query cache（filter cache）** | per shard，cache filter context 結果 | 部分（filter 命中，但 score 要重算） |
| **Request cache** | per shard，cache 整包 response | 預設只對 size=0（純 aggregation）有效 |
| **Field data cache** | sort / aggregation 用的欄位值 | 間接（熱欄位常駐 memory） |
| **OS page cache** | Linux file system，hot segment 留 RAM | 大但顆粒度低 |

對「Tokyo 12 月」這種 popular query，ES 內建命中有限。Filter 部分可命中，但 score 排序、aggregation 結果都要重算。Latency 5-20ms，沒到 sub-ms。

### Layer 2：Application Redis cache（主角）

```text
Frontend → Backend
              ↓
       Backend 算 cache key
              ↓
         Redis 看有沒有
       ├── 命中 → 直接回（~1ms）
       └── 沒中 → 打 ES → 拿結果 → 寫 Redis（TTL 60s）→ 回
```

對 popular query：
- 第 1 個 user：打 ES，~50ms，回結果並 cache 60s
- 接下來 60 秒所有人 search 同 query：直接 Redis 拿，~1ms

砍掉 ES 重複計算 + 砍掉網路往返，**latency 50x 改善**。

---

## Naive cache key 為什麼破功

直覺寫法：

```ts
const cacheKey = hash({ location, dates, guests, filters, sort });
```

5-tuple hash。**命中率超低**。每個維度的「重複機率」差很多：

| 維度 | 取值空間 | 重複機率 |
|---|---|---|
| `location` 文字（Tokyo） | ~幾千個城市 | 高 |
| `location` bbox（地圖坐標） | 連續實數，小數 6 位 | **趨近 0** |
| `dates` | 任意日期區間 | 中（熱門檔期密集） |
| `guests` | 1-10 | 高（離散） |
| `filters` | boolean 組合 | 看組合數 |
| `sort` | 4-5 個固定選項 | 高 |

**bbox 是殺手**。User 拖一下地圖，東邊跑 3 度，bbox 整個變，跟上一個 query 不可能 match。100% 不命中。

---

## 解法 1：Normalize 連續值

把連續值拉齊到網格，讓不同 user 的 query 收斂到同一個 cache key。

### 日期對齊

```ts
// 原始
{ check_in: "2026-12-22", check_out: "2026-12-29" }
{ check_in: "2026-12-23", check_out: "2026-12-30" }
// 兩個 key 不同，但旅遊行為差不多

// Normalize：對齊到「12 月聖誕週」
{ travel_period: "xmas-2026" }
// 變同一個 key
```

或更粗：`travel_month: "2026-12"`，把整月當一個 bucket。

### Bbox 量化

```ts
// 原始
bbox = [35.659, 139.700, 35.671, 139.734]

// Snap to geohash grid（precision 5，約 5km × 5km 一格）
const cell = geohash(lat, lon, precision: 5)  // "xn76uxn"
```

任何點落在這格的 bbox query 共用 cache。代價：cache 結果包含整個 grid，client 要再 filter，但 bandwidth 還是省。詳見 [geohash chunk](chunk://geohash)。

### Price 量化

```ts
// 原始
{ price_min: 187, price_max: 412 }

// Snap to 50 倍數
{ price_min: 150, price_max: 450 }
```

很多 UI 直接強制只能選預設 bucket（checkbox 不是 slider），從源頭就 normalized。Amazon、Booking 都這樣。

### Filter 排序

```ts
// 原始（順序不同 → key 不同）
amenities: ["wifi", "kitchen", "ac"]
amenities: ["ac", "kitchen", "wifi"]

// Sort 後 → 同 key
amenities: ["ac", "kitchen", "wifi"]
```

---

## 解法 2：Canonical 來源 vs User-defined 拆兩條 path

最關鍵的設計思路。**不同進入方式 → 不同 cache 策略**：

| 進入方式 | bbox 來源 | Cache 策略 |
|---|---|---|
| Search bar 打地名 + Enter | **canonical bbox**（Tokyo 永遠是這個 bbox） | 完整 cache，命中率高 |
| URL share / bookmark 進來 | URL 內含的 bbox | 完整 cache |
| 點 explore 推薦城市 | canonical bbox | 完整 cache |
| **使用者拖地圖 / zoom** | user 當下 bbox（unique） | **不 cache 或 geohash bucket** |

### Canonical bbox 怎麼來

Backend 維護一張表（靜態 / 半靜態）：

```text
city_id → canonical_bbox + zoom
─────────────────────────────────
Tokyo   → [35.50, 139.40, 35.85, 139.95], zoom 11
Paris   → [48.81, 2.22, 48.91, 2.41],     zoom 12
NYC     → [40.49, -74.26, 40.91, -73.70], zoom 11
```

幾千個城市一行，存 Postgres `cities` table 或直接 hardcode。

### URL 設計反映 cache path

Airbnb 的 search URL：

```text
# Canonical search（沒 bbox params，backend 自動套 canonical）
/s/Tokyo--Japan/homes?adults=2&checkin=2026-12-22&checkout=2026-12-29

# User-defined search（有 ne/sw params，backend 知道是 user 自定 viewport）
/s/Tokyo--Japan/homes?adults=2&ne_lat=35.71&ne_lng=139.74&sw_lat=35.66&sw_lng=139.70
```

Backend 看 URL 就知道走哪條 cache path。**URL 設計 = cache 設計**，兩者綁在一起。

---

## 解法 3：Multi-tier cache

每層獨立 key，backend 主動 fallback：

```text
L1（高精度，低命中率）：
  key = hash(完整 5-tuple)
  value = 完整 response（20 listings + facets）

L2（粗粒度，高命中率）：
  key = hash(city + 日期週段)
  value = 該城市該檔期所有 listings 的 ID 列表
        ↓
        Client 拿到後再 filter price / amenities / sort

L3（最粗）：
  key = hash(city)
  value = 該城市的 popular listings（過去 7 天熱門前 200 筆）
```

Backend 邏輯：

```ts
const result = await redis.get(L1Key);
if (result) return result;

const ids = await redis.get(L2Key);
if (ids) {
  const listings = await es.mget({ index, ids });
  return clientSideFilter(listings, filters);
}

const popular = await redis.get(L3Key);
if (popular) {
  return clientSideFilter(popular, allFilters);
}

const fresh = await es.search(...);
await redis.setex(L1Key, 60, fresh);
return fresh;
```

**多數 production 只用 L1**，因為多層邏輯複雜 + bug 多。L2 / L3 只在 head query 占壓倒性流量時才值得做。

---

## Cache 衍生問題

### 1. Stampede（快取雪崩）

熱門 cache 失效瞬間，1000 個 request 同時打 ES，把 ES 弄死。

修法：
- **Single-flight**：同一 key 同時只允許 1 個 request 打 ES，其他人等
- **Stale-while-revalidate**：回 stale 結果 + 背景非同步更新
- **TTL jitter**：cache TTL 加隨機 ±10%，避免大批同時過期

詳見 [cache-hot-key 文章](article://cache-hot-key)。

### 2. Cache poisoning / 惡意灌單

惡意 user 灌大量 unique query 撐爆 cache。

修法：
- **Admission policy**：cache 前先看 query 是否「值得 cache」（出現次數 > N 才 cache）
- **[Rate limit](chunk://rate-limiter) per IP**
- **TinyLFU eviction**（LRU 加上 frequency 評估）

### 3. Cache invalidation

```text
host 改 listing 價格 → Postgres 更新 → CDC 同步到 ES
  ↓
ES 內 listing 是新的
  ↓
但 Redis cache 還是舊的！
  ↓
使用者看到舊價格，點進去發現不對
```

三種解：
1. **TTL 短（60s）**：接受 60s 內可能 stale，簡單但不完美
2. **Event-driven invalidation**— listing 更新時 backend 主動清相關 cache（要 tag-based cache）
3. **Cache 不存 listing detail，只存 IDs + facets**：命中後再去 ES batch 拿詳情（犧牲 latency 換新鮮度）

Production 常用 1 + 2 混合。[CDC](chunk://cdc) 路徑加一個 cache invalidator consumer，listing 變更直接推。

### 4. Personalized query 不能 cache

Login user 的 ranking 受個人歷史影響，**每人結果不同**。
解法：anonymous user 走 cache 路徑，login user 直接打 ES（或 cache 個人 user-specific 的小東西）。

---

## 從 naive 到 production 的演進

cache key 設計通常是一步步被逼出來的：

**起手：直接 cache。** 「search 慢？加 Redis cache 就好。」只想到「cache = 解法」，沒想 cache 什麼、怎麼 invalidate、key 怎麼設。

**第一版：key + TTL。** cache key 用 query params hash 起來，TTL 60 秒，資料更新靠 TTL 過期。知道要有 key 跟 TTL、知道 staleness 是 trade-off，但還沒想命中率，以為「設了就有用」。

**轉折：開始質疑命中率。** 「等等，這 cache key 5 個維度 hash 起來，**幾乎每個 user 的 query 都不一樣，命中率會超低**，光 bbox 是連續實數就破功了。」設了不等於有用，從這一版開始算 cache hit rate、看 head query / long tail 分布。

**對症下藥：** 就是前面那套解法：normalize 連續值（price snap to bucket、bbox snap to geohash）、canonical vs user-defined 拆兩條 path、multi-tier cache、挑該不該 cache（personalized 不 cache）、stampede prevention。

**再上一層：把 cache 當系統工程。** 根本問題是「預測哪些 query 該被 cache」：觀察 traffic 動態識別 hotspot（top 100 cache key 自動標記、自動延長 TTL）、分層 cache 跨 region（CDN edge / regional Redis / 中央 Redis）、用 ML 做預測式 prefetch、算 cost vs latency curve、對抗 cache poisoning。到這一步，cache 不只是技術選擇，是 metric / cost / 風險的取捨。

---

## 跨領域應用清單

這套 cache key 思路直接套到其他系統：

### Twitter feed

- **問題**：user_id × cursor 是 cache key，但每 user 都有自己 timeline，命中率近 0
- **解法**：fan-out on write（熱門 user 的 follower timeline 預先寫好，讀直接拿） + cursor normalize

### YouTube video metadata

- **問題**：video_id 當 key，千萬個 video，popular video 占 10% 流量
- **解法**：popular video 重 cache（TTL 1 小時），long tail 不 cache；personalized homepage 個人 cache

### Uber matching（driver location）

- **問題**：driver 位置一直變，沒法 cache 個別 driver
- **解法**：cache 是「某 [geohash](chunk://geohash) 格子內有哪些 driver」，driver 移動只 invalidate 兩個格子（進的跟離開的）

### URL shortener

- **問題**：shortcode → 原 URL 是固定 mapping，但 long tail short URL 占多數
- **解法**：hot URL CDN cache + edge cache，cold URL 直接打 DB（可接受高 latency）

---

## 決策場景

你是 Airbnb-like 訂房平台的 backend lead。MAU 從 50 萬衝到 500 萬，ES cluster 從 6 台擴到 30 台還是 p95 latency 慢慢往上爬。盤點原因：popular city（Tokyo / Paris / NYC）每秒幾百次重複 query，但每個 user 拖地圖、選 dates、改 filter，cache key 都不同。

第一輪：在 Backend 跟 ES 之間加 Redis，cache key 是 5-tuple hash。上線一週，cache hit rate 8%。Senior 同事看到數字皺眉：「8% 你加這層 cache 幹嘛？」

第二輪：拆 canonical vs user-defined path。地名搜尋走 canonical bbox（hash 變得很穩定），地圖拖動走 geohash 量化（precision 5）。日期 normalize 到「該月份某一週」bucket。Filter 排序統一。

上線後 cache hit rate 跳到 47%，p95 latency 降回 90ms。同時 ES cluster 從 30 台縮回 18 台（cache 擋掉一半流量）。

### Regret condition

Cache hit rate 不是越高越好。**70% 是危險訊號**，表示 cache 過於激進，使用者拿到的可能是過時的 listing 或價格。某天客服收到一波投訴：「我看到的價格跟結帳價格差 30%」。原因：價格 snap to 50 倍數那個 normalize 太粗，host 把房價從 $187 改到 $237，但兩個都 normalize 到同一個 bucket，cache 看起來沒變。

修：把 price snap 從 50 改成 25，或在 listing detail 頁進去再驗一次價格。**命中率高不一定是好事**。為了衝命中率你會 cache 得太兇，使用者就一直拿到舊資料。真正該看的是「舊到什麼程度還能接受」。
