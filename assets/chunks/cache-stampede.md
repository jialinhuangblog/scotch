---
title: "Cache Stampede"
slug: cache-stampede
brief: "雪崩、穿透、擊穿：cache 沒擋住流量的三種原因，各有對應解法。"
date: 2026-07-20
updated: 2026-07-20
revisions: 1
article: cache-hot-key
---

# Cache 崩潰的三種情境

cache 擋在 DB 前面吸收流量，沒擋住的話 DB 要面對全部請求，超過承載就掛了。根據觸發原因不同，分成三種。

## 雪崩（Cache Avalanche）

大量 key 同時過期，請求瞬間全部穿過 cache 打到 DB。

```text
00:00  批次寫入 10 萬筆 cache，TTL 全設 30 分鐘
00:30  10 萬筆同時過期
       → 10 萬個請求同時 cache miss
       → 全部打到 DB
       → DB 負荷不了就掛了
```

最常見的原因就是 TTL 設成一樣的固定值。

**解法**：

| 方法 | 做法 |
|---|---|
| TTL 加隨機值 | `TTL = 30min + random(0~5min)`，讓過期時間分散 |
| 永不過期 + 背景刷新 | cache 不設 TTL，另起 worker 定期更新 |
| 多層 cache | 本地 cache（L1）+ Redis（L2），Redis miss 還有本地擋 |
| 限流 | cache miss 時限制打到 DB 的併發數 |

**L1 / L2 跟 CPU cache 無關**。這裡的 L1 = **app process 內的本地 cache**（Node.js `Map`、Java Caffeine、Go bigcache 之類，存取 ~100 ns），L2 = **遠端共享 cache**（Redis / Memcached，存取 ~500 μs 含網路）。只是借用「層級越近越快」的命名，實作上跟 CPU 硬體 cache 是完全不同的東西。

分層的意義：L1 擋掉最熱的請求（單一 process 內命中，不走網路），L2 處理 L1 miss 的流量（跨 server 共用）。雪崩時就算 Redis 的 key 大量過期，L1 還有機會命中，不會全部穿透到 DB。

代價是 L1 的一致性難處理，每台 app server 各有一份，DB 更新後要靠短 TTL 或 pub/sub 通知失效。所以 L1 通常只放「可以 stale 幾秒沒關係」的資料（設定、目錄、enum），敏感資料（庫存、餘額）只用 L2。

## 穿透（Cache Penetration）

查詢的 key 根本不存在，cache 沒有，DB 也沒有。每次都白查兩層。

```text
攻擊者不斷查 id=-1 的用戶
  → cache 沒有（從來沒存過）
  → DB 也沒有（不存在的資料）
  → 每次都穿透到 DB
  → 如果量夠大，DB 就掛了
```

跟雪崩的差別：雪崩是「有的資料過期了」，穿透是「資料根本不存在」。

**解法**：

| 方法 | 做法 |
|---|---|
| 快取空值 | DB 查不到也寫一筆 `cache("user:-1", null, TTL=5min)`，短時間內不再查 DB |
| Bloom filter | 先查 bloom filter，「一定不存在」就直接回傳，不查 DB 也不查 cache。詳見 [Bloom Filter](chunk://bloom-filter) |

Bloom filter 是更根本的解法。用極少記憶體（10 bit per key）就能擋住「確定不存在」的查詢，false positive rate 不到 1%。

## 擊穿（Cache Breakdown）

單一熱點 key 過期的瞬間，大量請求同時湧入。

```text
首頁推薦商品 cache key 過期
  → 1 萬個用戶同時請求這個商品
  → 全部 cache miss
  → 1 萬個請求同時查 DB 同一筆資料
  → DB 被流量灌爆
```

跟雪崩的差別：雪崩是大量 key 同時過期，擊穿是一個 key 過期但它太熱門。

**解法**：

| 方法 | 做法 |
|---|---|
| Singleflight | 單機層先 dedup：同一台 server 內的重複請求只放一個出去，其他等結果 |
| 互斥鎖（Mutex） | 跨機器層：第一個 miss 的請求搶鎖去查 DB，其他請求等它寫回 cache 後再讀 |
| 永不過期 + 背景刷新 | 熱點 key 不設 TTL，背景 worker 定期更新 |
| 預熱 | 系統啟動時主動載入熱點資料到 cache，不等第一次 miss |

兩層都做時順序固定：先 singleflight 再搶鎖，不然一萬個請求全部打 Redis 搶 SETNX，Redis 自己先被打爆。完整推演在深入閱讀的文章裡。

互斥鎖的邏輯：

```text
GET cache("hot-item") → miss
  → SETNX lock("hot-item") → 成功，拿到鎖
    → 查 DB → 寫回 cache → 釋放鎖
  → SETNX lock("hot-item") → 失敗，別人在查了
    → sleep 50ms → 重試 GET cache("hot-item") → 有了
```

## 三種放一起對照

| 名稱 | 觸發原因 | 核心解法 |
|---|---|---|
| 雪崩 | 大量 key 同時過期 | TTL 加隨機值 |
| 穿透 | key 根本不存在 | [Bloom filter](chunk://bloom-filter) |
| 擊穿 | 單一熱點 key 過期 | 互斥鎖 |

這三個其實是同一件事：cache 沒擋住，請求就全部直接打到 DB。差別在觸發原因和對應的防禦方式。讀寫策略本身另見 [Cache Strategies](chunk://cache-strategies)。
