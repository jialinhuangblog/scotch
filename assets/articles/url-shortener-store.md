---
title: "幾十億條對應關係塞進一個盒子，它查慢個零點幾秒，前面請求就全卡著等"
slug: url-shortener-store
subtitle: "read-heavy 系統的儲存策略。每一層 cache 都是為了不碰下一層。"
chapter: "url-shortener"
tags: [url-shortener, sharding, consistent-hashing, cache, redis]
date: 2026-03-21
related: [url-shortener-key, url-shortener-read, url-shortener-demo]
---

# 幾十億條對應關係塞進一個盒子，它查慢個零點幾秒，前面請求就全卡著等

上一篇解決了 key 怎麼生。現在有幾十億筆 short_key → long_url 的 mapping。每天新增 100 萬筆，存五年大約 20 億筆。

這些資料存在哪？怎麼讀得快？

---

## Schema

最基本的一張表：

```sql
CREATE TABLE url_mappings (
  short_key   VARCHAR(7)  PRIMARY KEY,
  long_url    TEXT        NOT NULL,
  user_id     BIGINT,
  created_at  TIMESTAMP   DEFAULT now(),
  expires_at  TIMESTAMP
);
```

讀：`SELECT long_url FROM url_mappings WHERE short_key = ?`
寫：`INSERT INTO url_mappings (short_key, long_url, ...) VALUES (?, ?, ...)`

Point lookup by primary key。B-Tree 的最佳場景。單機 100 萬筆以內，這就夠了。

---

## Read-Heavy 的數學

短網址服務的特性：建立一次，redirect 無數次。

```text
假設：
  每天新增 100 萬個短網址（寫）
  每個短網址平均被點擊 100 次（讀）
  讀寫比 = 100:1

  寫 QPS = 1,000,000 / 86,400 ≈ 12/s
  讀 QPS = 12 × 100 = 1,200/s
  尖峰讀 QPS = 1,200 × 5 = 6,000/s
```

12 QPS 的寫入，單機 MySQL 綽綽有餘。6,000 QPS 的讀取，單機也能撐。但如果服務成長到每天 1 億個新 URL，尖峰讀 QPS 就是 60 萬。單機撐不住。

---

## 第一步：加 Cache

Read-heavy 系統的標準做法：在 DB 前面放 Redis。

### Cache-Aside 模式

```text
讀取 short_key = "Xk9mP2q"
  → 查 Redis
    ├─ 命中 → 直接回傳 long_url（不碰 DB）
    └─ 沒命中 → 查 DB → 寫入 Redis → 回傳 long_url
```

短網址的 cache 效果特別好。原因：

1. **Value 不會變。** short_key 對應的 long_url 建立之後就不改了。不存在 cache 和 DB 不一致的問題。
2. **Hot key 集中。** 大部分流量集中在少數熱門短網址。20% 的 URL 承擔 80% 的流量。Cache 命中率極高。
3. **Value 小。** 一筆 mapping 就是一個 string（短 key）對一個 string（URL）。Redis 可以塞幾億筆。

### Cache 大小怎麼估

```text
假設 cache 存 20% 的 URL（熱門的那些）
20 億 × 20% = 4 億筆
每筆：key 7 bytes + URL 平均 200 bytes + overhead ≈ 300 bytes
4 億 × 300 bytes = 120 GB
```

120 GB 一台大記憶體 Redis 還塞得下，但實務上會用 Redis Cluster 分散，比較有彈性。cache 層的 sharding 和 DB 層的 sharding 是分開的問題，可以獨立擴容。

### TTL 策略

短網址本身有 `expires_at`。Cache 的 TTL 不需要對齊 URL 的過期時間。Cache TTL 是為了控制記憶體用量。

```text
常見做法：cache TTL = 24 小時
  → 超過 24 小時沒被存取的 URL 自然過期
  → 下次被存取時重新從 DB 載入
```

已過期的 URL（`expires_at < now()`）在 DB 查到後直接回 404，不寫入 cache。避免已死的 URL 佔 cache 空間。

---

## 第二步：DB Sharding

Cache 擋住了 80%+ 的讀取。但 DB 本身 20 億筆、500 多 GB，容量還好，吃緊的是寫入 QPS 跟 backup。

### Shard Key 選 short_key

```text
shard = hash(short_key) % N
```

為什麼不用 user_id？因為 redirect 請求只帶 short_key，不帶 user_id。如果按 user_id 分 shard，redirect 時不知道去哪台 DB 查。

按 short_key 分 shard，redirect 時直接算 `hash(short_key) % N` 就知道去哪台。

### 寫入路由

建立短網址時，先產生 short_key（上一篇的三種方法：hash 截斷、counter + base62、snowflake + base62），再用同一個 hash 算出 shard，寫入對應的 DB。

```text
建立：
  short_key = "Xk9mP2q"
  shard = hash("Xk9mP2q") % 4 = 2
  → INSERT INTO shard_2.url_mappings ...

redirect：
  short_key = "Xk9mP2q"
  shard = hash("Xk9mP2q") % 4 = 2
  → SELECT FROM shard_2.url_mappings WHERE short_key = "Xk9mP2q"
```

讀和寫用同一個 hash function，保證打到同一台。

### Consistent Hashing

`hash % N` 的問題：加一台機器，N 變了，大量 key 要搬家。

Consistent hashing 把 hash 空間變成環（詳見 [consistent-hashing](chunk://consistent-hashing) chunk）。加一台機器只影響環上相鄰的一小段，搬遷量從 ~75% 降到 ~1/N。

```text
4 台 shard，加第 5 台：
  hash % N：   ~80% 的 key 要搬
  consistent hashing：~20% 的 key 要搬
```

短網址服務的 mapping 是 immutable。搬遷時不用擔心寫入衝突，只需要把舊 shard 的資料複製到新 shard。

---

## 容量估算

面試官經常要求估算。

```text
假設：
  每天 100 萬個新 URL
  保留 5 年
  total = 100 萬 × 365 × 5 = 18.25 億 ≈ 20 億筆

每筆：
  short_key:   7 bytes
  long_url:    平均 200 bytes
  user_id:     8 bytes
  created_at:  8 bytes
  expires_at:  8 bytes
  index overhead: ~50 bytes
  ≈ 280 bytes/row

total storage = 20 億 × 280 bytes ≈ 560 GB

4 台 shard：每台 140 GB。加 replication（1 leader + 1 follower）= 8 台 DB instance。
```

560 GB 不算大。對 MySQL 或 PostgreSQL 來說，單機也能放得下。Sharding 更多是為了分散 QPS，不是為了容量。

---

## 過期 URL 的清理

`expires_at` 過了的 URL 不應該繼續佔空間。

### Lazy deletion

Redirect 時查到 `expires_at < now()`，回 404，順便刪掉這筆 cache。DB 的資料不急著刪。

### Background cleanup job

定期跑 batch job：

```sql
DELETE FROM url_mappings
WHERE expires_at < now() - INTERVAL '7 days'
LIMIT 10000;
```

加了 7 天的 buffer，避免刪到剛過期、使用者可能還會再存取的 URL。`LIMIT` 避免一次刪太多造成 lock contention。

---

## 面試官追問

---

> **「cache 和 DB 同時掛了一台，怎麼辦？」**
>
> 這叫 **cache avalanche（快取雪崩）**。Redis 掛了，request 全部穿透到 DB，DB 本來只承受 20% 的量，突然變成 100%，也跟著掛。一層倒了壓垮下一層。
>
> 三層防禦，遞進關係：
>
> 1. **Redis HA**（Sentinel / Cluster）— 讓 Redis 根本不掛。Master 掛了自動 failover promote follower。
> 2. **Local cache**（in-process LRU）— Redis 掛了，application 記憶體裡的 Map 還能擋住熱門 key。不走網路，同一個 process 裡直接讀，比 Redis 更快。每台 server 各自一份，不共享。
> 3. **Circuit breaker** — DB 快死了，自動斷路，直接回 503，不再打 DB。定時放幾個 request 試探，DB 恢復了再合路。從 application 角度看「我打 DB 有沒有正常回」（timeout、connection refused、error），不需要看 DB 內部的 CPU / 記憶體指標。
>
> ```text
> request → local cache（~100 ns，同 process）
>   miss → Redis（~0.5 ms，走網路）
>     miss → circuit breaker → DB（~1-10 ms）
>                              ↑ 錯誤率 > 50% 就斷路，回 503
> ```
>
> Redis 死了服務變慢但還能回應。DB 死了資料讀不到也寫不了，服務直接掛。所以 circuit breaker 保護的是 DB，它是最後一層，倒了沒退路。

---

> **「100 萬人同時點同一個短網址，cache 剛好過期。會發生什麼？」**
>
> **Cache stampede / thundering herd**。100 萬個 request 同時 cache miss，同時打 DB 查同一筆資料。DB 被同一個 query 打 100 萬次。
>
> 解法：**Singleflight**（也叫 request coalescing）。同一個 key 的重複查詢，只放第一個去查 DB，其他等結果。
>
> ```text
> request 1 → cache miss → 去查 DB
> request 2~1,000,000 → cache miss → 發現有人在查同一個 key → 等
> DB 回來了 → 寫入 cache → 所有人拿到同一個結果
> ```
>
> 實作是在 process 裡維護一個 Map，記住「這個 key 正在查」：
>
> ```go
> // Go — 官方 package
> import "golang.org/x/sync/singleflight"
>
> var g singleflight.Group
>
> func resolve(shortKey string) (string, error) {
>     val, err, _ := g.Do(shortKey, func() (interface{}, error) {
>         return db.Query(shortKey) // 只有第一個會跑這裡
>     })
>     return val.(string), err
> }
> ```
>
> ```typescript
> // TypeScript — 自己寫，十幾行
> const inflight = new Map<string, Promise<string>>();
>
> async function singleflight(key: string, fn: () => Promise<string>) {
>   if (inflight.has(key)) return inflight.get(key)!; // 有人在查，等他
>   const promise = fn();
>   inflight.set(key, promise);
>   try { return await promise; }
>   finally { inflight.delete(key); }
> }
> ```
>
> 跟 debounce / throttle 不同：debounce 延遲觸發，throttle 丟掉多餘的 request。Singleflight 不延遲也不丟，第一個立刻查，其他搭便車，每個人都拿到結果。
>
> Singleflight 擋住瞬間的重複查詢，查完的結果存進 cache，之後就走正常的 cache hit。

---

> **「shard key 選 short_key。但某個 shard 的 URL 特別熱門，流量是其他 shard 的 10 倍。怎麼處理？」**
>
> Virtual node 針對的是均衡分布，熱點 key 要另外處理。一個 URL 爆紅，那個 key 不管落在哪個 shard，那台就是 10 倍流量。Resharding 只是把 hot key 搬到另一台，那台又變成 hot shard。
>
> 解法在 cache 層，不是 DB 層。讓流量根本不到 DB：
>
> ```text
> 1. Redis cache → 擋住 90%+ 讀取（預設就有）
> 2. Local cache（in-process LRU）→ hot key 連 Redis 都不用打。LRU 容量自己設，例如 10,000 筆（每筆 key 7 bytes + URL ~200 bytes + overhead ~100 bytes ≈ 300 bytes，10,000 筆 ≈ 3 MB）。大部分流量集中在少數熱門 URL（80/20 法則），不需要存很多筆就能擋住大部分 hot key
> 3. Redis key 複製 → 同一筆資料存多份，讀取時隨機挑一個，分散 Redis 單點壓力
>    （只有單一 key QPS 逼近 Redis 單節點上限 ~10 萬/s 才需要）
> ```
>
> 各層的延遲和 QPS 上限：
>
> | 層 | 單次延遲 | QPS 上限 | 為什麼 |
> |---|---|---|---|
> | local cache | ~100 ns | 幾百萬/s | 同 process 讀 Map，受 CPU 限制 |
> | Redis 單節點 | ~0.5 ms | ~10 萬/s | RAM 操作，但走網路 |
> | DB 單機 | ~1-10 ms | ~5,000-10,000/s | SSD + SQL 解析 + B-Tree 查找 |
>
> Redis 比 DB 快的原因不只是延遲低 10 倍。Redis 是純 RAM HashMap 查找，沒有 SQL 解析、沒有磁碟 IO。它還讓 DB 少做事：10 萬個 request，Redis 擋住 9 萬個，DB 只處理 1 萬個。

---

> **「resharding 的時候（4 台變 8 台），線上的 redirect 請求還能正常服務嗎？」**
>
> 可以。short_key 不變，資料不變，只是搬家。變的是 `% N` 的 N：
>
> ```text
> key = "Xk9mP2q"
> 舊：hash("Xk9mP2q") % 4 = 2 → 資料在 shard_2
> 新：hash("Xk9mP2q") % 8 = 6 → 應該搬到 shard_6
> ```
>
> 遷移期間雙查，短網址是 immutable 所以新舊一定一致：
>
> ```text
> request "Xk9mP2q" 進來
>   → 用新 hash：% 8 = 6 → 查 shard_6
>     還沒搬過來 → 沒有
>   → 用舊 hash：% 4 = 2 → 查 shard_2
>     有 → 回傳
>
> 背景搬完後：
>   → 用新 hash：% 8 = 6 → 查 shard_6 → 有 → 回傳（不用查舊的了）
> ```
>
> 全部搬完，關掉「查舊 shard」的邏輯。如果資料會改（mutable），雙查就麻煩了：新舊 shard 的值可能不同，不知道以誰為準。但短網址不改，雙查沒問題。

---

> **「URL mapping 是 immutable，但用戶想修改 long_url（改目標網址）。cache 怎麼處理？」**
>
> Immutable 的假設被打破了。DB 改了，但 Redis 和 local cache 還存著舊值。Cache invalidation 出場。
>
> 做法：先改 DB（source of truth），再把 Redis cache 那筆刪掉，讓下次讀重新從 DB 載入。
>
> ```text
> 1. UPDATE DB：  "Xk9mP2q" → "https://example.com/new-page"
> 2. DEL Redis：  刪掉 "Xk9mP2q"（讓它下次 miss 重載）
> 3. 下一個 request → cache miss → 從 DB 拿最新值 → 寫入 cache
> ```
>
> 刪而不是更新，因為刪是冪等的（刪兩次沒差）。更新有 race condition：兩個人同時改，誰最後寫 cache 不確定。
>
> 不能反過來先改 cache 再改 DB：cache 改成功但 DB 失敗，重啟後 cache 從 DB 重建又變回舊值。DB 是 source of truth，永遠先改 DB。
>
> Local cache：設短 TTL（例如 30 秒）自然過期，或改 DB 時發 event 通知所有 server 清掉那筆。
>
> 這跟 WAL 無關。WAL 是 DB 內部保護寫入不丟（SSD 層面），cache invalidation 是保持 DB 和 cache 一致（application 層面）。

---

> **「不要只存 URL mapping。加上每個短網址的建立者、點擊次數、最後點擊時間。schema 怎麼變？read/write pattern 怎麼變？」**
>
> 原本是 read-heavy：建立一次（寫），redirect 無數次（讀），讀寫比 100:1。加了 click_count 和 last_clicked_at 後，每次 redirect 都要更新，read-heavy 變成 read-write mixed。
>
> 直接每次 redirect 都寫 DB 撐不住。6,000 QPS 的讀取變成 6,000 QPS 的寫入，DB 寫入比讀取貴很多。把「即時回應」和「資料記錄」拆開：
>
> ```text
> click_count：Redis INCR（原子操作，O(1)）
>   每次 redirect：INCR click_count:Xk9mP2q
>   Dashboard 查詢：GET click_count:Xk9mP2q → 12,847
>   定期同步到 DB 做持久化
>
> last_clicked_at + 詳細 analytics：丟進 Kafka
>   redirect 時發 click event → Kafka → consumer 寫入 analytics DB（ClickHouse）
>   redirect path 完全不碰 DB
> ```
>
> Redirect 只多做兩件毫秒級操作（Redis INCR + Kafka append），不碰 DB。詳見第三篇 `url-shortener-read`。

---

## 沒有 X 怎麼辦

---

> **「不能用 Redis。read-heavy 的 DB 怎麼扛？」**
>
> 兩層替代：
>
> 1. **Read replica** — DB 的 leader-follower replication，讀打 follower。加 3 個 read replica，QPS 就翻 3 倍。短網址的 mapping 不會改，replication lag 不影響正確性。
> 2. **Local cache（in-process LRU）** — application 記憶體裡的 Map，擋住熱門 key，不走網路。
>
> ```text
> 有 Redis：   request → local cache → Redis → DB
> 沒有 Redis： request → local cache → read replica
> ```
>
> 沒有 Redis 共享 cache 那麼省。每台 server 的 local cache 各自一份，同一個 key 在不同 server 上各查一次 DB 才會進 cache。但兩層加起來足以應付大部分場景。

---

> **「不能用 consistent hashing library。shard 怎麼分配？」**
>
> 最簡單的 `hash % N`，一行就寫完：
>
> ```text
> shard = hash("Xk9mP2q") % 4 = 2 → shard_2
> ```
>
> 缺點是加機器時 N 變了，大部分 key 要搬。但短網址是 immutable data，搬遷時不用處理寫入衝突，用雙查（先查新 shard，沒有再查舊 shard）就能在線上完成遷移。

---

> **「不想用 managed DB（RDS、Cloud SQL），自己架。backup 和 failover 怎麼做？」**
>
> 自己架就是自己負責 managed DB 幫你做的事。
>
> **Backup**：
>
> ```text
> PostgreSQL：
>   pg_basebackup — 完整備份
>   WAL archiving — 持續把 WAL 檔案存到 S3
>   兩者結合 → Point-in-Time Recovery（還原到任意時間點）
>
> MySQL：
>   mysqldump — 邏輯備份（慢但通用）
>   xtrabackup — 物理備份（快，不鎖表）
> ```
>
> **Failover**：
>
> ```text
> PostgreSQL：
>   Patroni — 自動管理 leader-follower，leader 掛了自動 promote
>   手動：pg_promote() 把 follower 升級成 leader
>
> MySQL：
>   MHA（Master High Availability）— 自動 failover
>   手動：STOP REPLICA → RESET REPLICA ALL → 變成新 leader
> ```
>
> 指令本身次要，講得出機制跟取捨才過得了關。RDS 的「Multi-AZ」就是自動 failover，「Automated Backups」就是 WAL archiving + base backup。

---

## 這篇到這裡

Key 生出來了，mapping 存好了，cache 和 shard 都就位。下一個問題：每秒十萬次 redirect 的 read path 怎麼走？有人要看 click analytics 怎麼辦？
