---
title: "cache 平常都夠用，直到所有人同一秒都去要同一個 key"
slug: cache-hot-key
subtitle: "Cache avalanche、penetration、stampede。三種請求沒由 cache 回應、直接進到 DB 的情況，和怎麼保護 DB。"
chapter: "buffer"
tags: [cache, redis, bloom-filter, singleflight, cache-strategies]
date: 2026-03-31
updated: 2026-06-08
revisions: 1
related: [queue-peak-shaving, rate-limiter, scaling-first-move, search-cache]
---

# cache 平常都夠用，直到所有人同一秒都去要同一個 key

Cache 放在 DB 前面，能由 cache 回應的請求就不必進到 DB。

平常不會去想它。它早就是 best practice，框架包好之後貼上配置就能跑。除非哪天要從零寫一個，或是它在半夜出事，不然很難真的理解它讓 DB 少收了哪些請求，又是在什麼情況下失效的。

```text
正常：
用戶 → Redis（命中）→ 回傳資料。DB 沒事。

Cache 沒命中：
用戶 → Redis（沒命中）→ DB → DB 負載過高 → 整個系統掛
```

---

## 雪崩、穿透、擊穿的英文對照

雪崩、穿透、擊穿這套乾淨的三分法，是簡體中文面試圈切出來的。繁體中文沒有自己的一套講法，所以這裡直接用英文。但英文圈的界線比中文模糊。

- **Cache stampede**：一個熱門 key 過期，大量請求在同一時間湧向 DB。Wikipedia 記的別名是 **dog-piling**。另一個常混用的詞是 **thundering herd**，但它其實更廣，泛指一群 process 同時被喚醒，cache stampede 只是其中一種，實務上兩者常互換。中文面試圈把它叫「擊穿」。
- **Cache avalanche**：大量 key 同時過期。英文裡它常跟 stampede 混著講，因為後果一樣（DB 一次收到大量請求），差別只在過期的是一個 key 還是一批。中文叫「雪崩」。
- **Cache penetration**：查一個 cache 和 DB 都沒有的 key。英文討論的重心通常放在解法上，叫 **negative caching**。中文叫「穿透」。
- **Hot key**（或 hotspot）：跟前三個不同，它沒有過期問題，純粹是流量集中在同一個 key 上。

所以 avalanche 跟 stampede 在英文工程實務裡的界線是模糊的，乾淨切成三塊是教學跟面試畫出來的線。底下還是分開講，因為三者發生的狀況不同，補救方式也不一樣。

---

## Cache Avalanche：一批 key 在同一時間過期

一批商品資料同一時間寫進 cache，TTL 全設 30 分鐘。30 分鐘後 10 萬筆同時到期，cache 瞬間全空，請求全部打到 DB。

```text
00:00  批次寫入 10 萬筆，TTL = 30min
00:30  10 萬筆同時過期
         → cache 全部 miss
         → DB 負載瞬間飆高
```

問題出在 TTL 是固定值。一批 key 同時寫入、又給一樣的 TTL，就會在同一秒一起過期。

### 防禦：把過期時間打散

TTL 加一個隨機值。最簡單也最有效。

```text
TTL = 30min + random(0~5min)

key A 過期時間：30:00
key B 過期時間：32:17
key C 過期時間：34:45
key D 過期時間：30:52
```

10 萬筆分散在 5 分鐘內陸續過期，DB 每秒只收到幾百個 miss。

其他防禦：

| 方法 | 做法 | 適合 |
|---|---|---|
| TTL 加隨機值 | 過期時間分散 | 所有場景，預設就該這樣做 |
| 永不過期 + 背景刷新 | worker 定期更新 cache | 資料更新頻率可預期的場景 |
| 多層 cache | 本地 L1 + Redis L2 | 高可用要求，Redis 掛了還有本地 cache |
| 限流 | cache miss 時限制 DB 併發數 | 最後一道防線 |

---

## Cache Penetration：一直查詢根本不存在的 key

查的 key 根本不存在。cache 沒有，DB 也沒有，每次都白查兩層。

這跟 avalanche 不一樣。avalanche 是資料還在，只是 cache 暫時空了；penetration 是有人故意一直查詢從來不存在的 key。DB 查不到資料，就沒有值可以寫回 cache，所以同一個 key 每次查詢都會 miss 並進到 DB。

```text
攻擊者連續查 id = -1, -2, -3, ...
  → cache：沒有（從來沒存過不存在的東西）
  → DB：沒有（這些 id 根本不存在）
  → 每次都穿透到 DB
  → 量夠大，DB 就掛了
```

### 防禦一：把「不存在」也記下來（快取空值）

DB 查不到，也寫一筆進 cache。

```text
查 id=-1 → DB 沒有 → SET cache("user:-1", null, TTL=5min)

5 分鐘內再查 id=-1 → cache 命中（值是 null）→ 直接回「不存在」
```

簡單，但攻擊者每次換一個 id（-1, -2, -3...），每個都要存一筆 null，cache 很快被這些 null 塞滿。

### 防禦二：先用 Bloom Filter 過濾

在 cache 和 DB 之前再加一層，用極少的記憶體判斷「這個 key 一定不存在」。

```text
請求進來
  → Bloom filter：id=-1 一定不存在 → 直接回 404
     不查 cache，不查 DB，零成本

  → Bloom filter：id=42 可能存在 → 繼續查 cache → ...
```

Bloom filter 的保證是不對稱的：

- **說「不存在」就一定不存在。** filter 說沒有，那就真的沒有，100% 確定，可以安全跳過 cache 和 DB。
- **說「可能存在」卻有小機率其實不存在（false positive）。** Bloom filter 內部用多個 hash function 把 key 映射到 bit array，不同的 key 可能碰撞到同一組 bit，讓 filter 誤判「存在」。這時請求會穿過去查 cache 和 DB，發現不存在，但代價只是多查一次，不會算錯結果。

100 萬個 key 的 bloom filter 只佔 1.2 MB，false positive rate 不到 1%，也就是查 100 個不存在的 key，大約只有 1 個會被誤判成「可能存在」。快取空值則是攻擊者換幾個 id 就存幾筆 null，記憶體用量隨著攻擊持續增加。

詳細原理見 [Bloom Filter](chunk://bloom-filter)。

---

## Cache Stampede：大家同時搶同一筆剛過期的資料

一個熱點 key 過期，大量請求在過期的同時湧入。

avalanche 是一大批 key 一起過期，stampede 只有一個 key 過期，但它剛好是所有人都在搶的那個。

```text
首頁推薦商品的 cache key 過期了
  → 1 萬個用戶同時請求這個商品
  → 全部 cache miss
  → 1 萬個請求同時查 DB 要同一筆資料
  → DB 負載過高
```

### 防禦一：一次只放一個請求進去（互斥鎖 Mutex）

1 萬個請求都 miss，但只讓一個去 DB 查詢，其他等著。

```text
請求 A → cache miss → 搶鎖（SET NX） → 成功 → 查 DB → 寫回 cache → 釋放鎖
請求 B → cache miss → 搶鎖 → 失敗 → sleep 50ms → 重試讀 cache → 有了
請求 C → cache miss → 搶鎖 → 失敗 → sleep 50ms → 重試讀 cache → 有了
...
請求 10000 → 同上
```

1 萬個請求，只有 1 個打到 DB，其他 9,999 個多等 50~100ms。

用 Redis 的 `SET` 加上 `NX`（only set if Not eXists）當分散式鎖。舊的 `SETNX` 指令也是「不存在才設」，但它不能同時設過期時間，所以現在都用 `SET ... NX EX`：

```text
SET lock:hot-item 1 NX EX 5
    ^^^^^^^^^^^^^^ ^ ^^ ^^ ^
    key            值 |  |  過期秒數
                      |  EX = Expire（秒）
                      NX = key 不存在才設

key    → 自己取名，慣例 lock: 前綴表示這是鎖
value  → 這裡先填 1，下面的程式碼會換成 token
NX     → 只看 key 存不存在
EX 5   → 5 秒後自動刪除這個 key，防止拿鎖的 server 掛了鎖卡死
```

```text
SET lock:hot-item 1 NX EX 5    → key 不存在 → 設值成功，拿到鎖
SET lock:hot-item 1 NX EX 5    → key 已存在 → 什麼都不做，別人在查了
```

包成函式（Node）：

```ts
async function getWithLock(key: string): Promise<any> {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const token = crypto.randomUUID();
  // NX = 不存在才設，EX 5 = 5 秒自動過期，防拿鎖的 server 掛了鎖卡死
  const locked = await redis.set(`lock:${key}`, token, 'NX', 'EX', 5);

  if (locked) {
    try {
      const data = await db.query(key);               // 只有我打 DB
      await redis.set(key, JSON.stringify(data), 'EX', 1800);
      return data;
    } finally {
      await releaseLock(`lock:${key}`, token);
    }
  }

  // 沒搶到：等一下再讀 cache，通常第一次重試就有了
  await sleep(50);
  return getWithLock(key);
}
```

釋放鎖不能直接 `DEL`。A 執行太久鎖過期、B 拿到鎖，A 回來一個 `DEL` 就把 B 的鎖刪了。所以 value 填一個自己的 token，刪之前先確認鎖還是自己的，而 compare 和 delete 要原子執行，用 Lua：

```ts
const RELEASE = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end`;

function releaseLock(lockKey: string, token: string) {
  return redis.eval(RELEASE, 1, lockKey, token);
}
```

### 防禦二：同一台機器內先 dedup（Singleflight）

互斥鎖是跨機器的，Singleflight 是同一台機器內的 dedup。實作是一個 Map，存還在進行中（in-flight）的 Promise：

```ts
const inflight = new Map<string, Promise<any>>();

async function singleflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing;          // 已經有人在查了，跟著等同一個 Promise

  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
```

同一台 server 上 3000 個併發請求同一個 key，`fn()` 只執行一次，其他 2999 個 await 同一個 Promise。它不需要任何網路操作，所以放在最前面。

```text
互斥鎖（分散式）：
  Server A, B, C 合起來 → 只有 1 個查 DB

Singleflight（單機）：
  Server A 內部 100 個 goroutine → 只有 1 個查 DB
  Server B 內部 100 個 goroutine → 只有 1 個查 DB
  → 還是有 2 個請求打到 DB（每台各一個）
```

Singleflight 成本幾乎為零（in-memory 的 map + mutex），互斥鎖要多一次 Redis 操作。實務上兩層都做，順序是先 singleflight 再搶鎖：

```text
1 萬個請求同時進來（分散在 3 台 server）

Server A (3000 個請求)
  → singleflight：3000 個只放 1 個出去，其他 wait
Server B (4000 個請求)
  → singleflight：只放 1 個出去
Server C (3000 個請求)
  → singleflight：只放 1 個出去

→ 剩 3 個請求去查 cache → 都 miss
→ Redis SET NX 搶鎖 → 1 個去 DB，2 個等
→ 寫回 cache → 各台 singleflight 把結果發給等待中的請求
```

為什麼不能反過來呢？先搶 Redis 鎖的話，1 萬個請求全部去 Redis 搶鎖，Redis 自己會先超載。先在本機用 singleflight 合併掉 99% 的重複請求，剩下的才需要跨機器搶鎖。

兩層串起來就是一行：

```ts
const item = await singleflight('hot-item', () => getWithLock('hot-item'));
```

Go 有內建 package `golang.org/x/sync/singleflight`。其他語言的對應：

| 語言 | 實作 |
|---|---|
| Go | `singleflight.Group.Do()` |
| Java | Guava `Cache.get(key, loader)` 內建 dedup |
| Node.js | 用 Map 存 pending Promise，key 相同就共用 |
| Nginx | `proxy_cache_lock on` |

通用概念叫 **request coalescing**，Singleflight 是 Go 社群的叫法。

### 防禦三：讓它永遠不過期（永不過期 + 背景刷新）

key 不設 TTL，另起 worker 定期去 DB 撈最新資料更新 cache。

```text
cache("hot-item", data, TTL=永不過期)

背景 worker 每 30 秒：
  → 查 DB 拿最新資料
  → 更新 cache("hot-item", newData)
```

key 不會過期，所以請求都命中 cache，不需要等 DB。

代價是資料最多落後 30 秒（看刷新頻率），還要額外維護 worker、要事先知道哪些 key 是熱點。適合首頁推薦、排行榜這種更新頻率可預期的場景。

### 互斥鎖加 singleflight 當預設，背景刷新留給超高 QPS

| 方法 | 延遲 | 資料即時性 | 複雜度 | 適合 |
|---|---|---|---|---|
| 互斥鎖 | 等鎖的請求多 50~100ms | 高（miss 時從 DB 拿最新的） | 低 | 大部分場景 |
| Singleflight | 幾乎無 | 高 | 極低 | 搭配互斥鎖，第一道防線 |
| 背景刷新 | 無 | 低（落後一個刷新週期） | 高 | 超高 QPS + 容忍延遲 |

---

## Hot Key：所有請求集中在同一個 key

前面三種都是 cache 失效。還有一種是 cache 沒失效、每次都命中，但所有人同時要同一筆資料，而那筆資料只存在一台 Redis node 上。

```text
user:123456:profile 每秒被 50 萬個請求讀取
  → consistent hashing 把這個 key 映射到 node-3
  → node-3 CPU 100%
  → 其他存在 node-3 的 key 也跟著變慢
```

### 解法：把一個 key 拆成多份（key shard）

把一個 key 拆成 N 個，分散到不同 node。

```text
user:123456:profile:0
user:123456:profile:1
...
user:123456:profile:9
```

讀的時候 `random(0, 9)` 挑一個，10 個 key 被 consistent hashing 映射到不同 node，流量就分散了。

寫的時候要更新全部 shard，代價是寫變 N 倍。Hot key 場景幾乎都是讀多寫少，這個 trade-off 值得。

```text
shard 數    讀流量分散   寫成本
10          ÷10         ×10
```

---

## 三種失效對照

三種都是請求沒被 cache 回應而直接進到 DB。

| | 發生在哪裡 | 補的是什麼 | 做法 |
|---|---|---|---|
| Avalanche | 大量 key 在同一個時間點一起過期 | 時間 | 把過期時間打散 |
| Penetration | 查詢的 key 根本不存在，cache 永遠存不住 | 入口 | 先過濾掉不存在的查詢 |
| Stampede | 一個剛好過期的熱點 key | 併發 | 同一時間只放一個請求去 DB |

---

## 資料一開始怎麼進 cache

這裡講的是 cache 失效時怎麼保護 DB。資料一開始怎麼進 cache、什麼時候更新，在 [Cache Strategies](chunk://cache-strategies)。

---

## References

- [Cache stampede](https://en.wikipedia.org/wiki/Cache_stampede)
- [Thundering herd problem](https://en.wikipedia.org/wiki/Thundering_herd_problem)
- [golang.org/x/sync/singleflight](https://pkg.go.dev/golang.org/x/sync/singleflight)
