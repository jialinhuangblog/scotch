---
title: "如何針對看起來在亂打的 user 限流量"
slug: rate-limiter
subtitle: "Token Bucket 允許 burst，Sliding Window 嚴格計數。選錯 key，比選錯演算法還麻煩。"
chapter: "buffer"
tags: [rate-limiter, redis, token-bucket, sliding-window, system-design-interview]
date: 2026-04-17
related: [cache-hot-key, queue-peak-shaving, scaling-first-move]
---

# 如何針對看起來在亂打的 user 限流量

前兩篇講的是 buffer：[cache 管讀](article://cache-hot-key)、[queue 管寫](article://queue-peak-shaving)。兩個都是把流量吸住，讓 DB 不被壓垮。

Cache 跟 queue 處理的是流量大小，rate limiter 看的是哪個 client 打太多。

一個 user 每秒打一萬次，其他人全卡住。不管你 cache 再厚、queue 再深，資源被一個人吃完，系統對其他人形同當機。Rate limiter 回答一個問題：**這個 client 該不該放行？**

```text
正常：
  User A 10 req/s → 放行 → cache → DB

被濫用：
  User B 10,000 req/s → Rate Limiter → 429 Too Many Requests
  其他用戶不受影響
```

---

## 第一個決策比演算法重要：Key 是誰

同樣 10,000 req/s，意義完全不同。

| 情境 | Key | 該擋嗎 |
|---|---|---|
| 單一 user 打 10,000/s | user_id | 擋 |
| 1,000 個 user 各打 10/s | user_id | 不擋（人均正常）|
| 匿名流量 | IP | 依情境 |
| 第三方呼叫你的 API | API key | 擋（保護 quota）|

Key 決定「誰跟誰分開算」。key 選錯，限流根本攔不到該攔的。

企業用 IP 做 key 看似合理，直到你發現整棟大樓共用一個 NAT IP。一擋就擋兩千人。這比較是業務面的判斷，跟用哪套演算法沒太大關係。

---

## 常見的兩種方式：token & sliding window

### Token Bucket：允許 burst

想像一個漏斗。每秒往裡面丟固定數量的 token，容量有上限。request 進來拿一個 token，沒 token 就擋。

```text
桶容量 capacity = 10
補充速率 refill_rate = 5/sec

  time=0        time=1        time=2
  ┌────────┐   ┌────────┐   ┌────────┐
  │ 10/10  │   │ 10/10  │   │  7/10  │
  └────────┘   └────────┘   └────────┘
  滿            +5 但已滿     消耗 3 個
```

User 安靜 30 秒，桶補滿。下一秒連打 10 個，全部放行。會這樣 burst 是正常的，真實人類就是點一下休息一會，回來連點好幾下。

Redis 存一個 hash：

```text
Key: rate_limit:user_123
Value: { tokens: 7, last_refill: 1700000000 }
```

每次 request 算 elapsed time，補 token，扣一個。問題：讀 → 算 → 寫這三步不是原子的。

```text
Request A                          Request B
  │                                  │
  ├─ 讀 tokens = 1                   │
  │                                  ├─ 讀 tokens = 1
  ├─ tokens >= 1 → 放行              │
  ├─ 寫 tokens = 0                   ├─ tokens >= 1 → 放行
  │                                  ├─ 寫 tokens = 0
  ▼                                  ▼
  兩個都放行了。實際發了 2 個，桶裡只有 1 個。
```

解法：把整段邏輯寫成一段 script 送進 Redis，讓 Redis 在 server 端一口氣跑完，中間不會被其他 request 插隊。Redis 用 Lua 語言寫這種 server-side script：

```lua
-- KEYS[1] = rate_limit:user_123
-- ARGV[1] = capacity, ARGV[2] = refill_rate, ARGV[3] = now
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(data[1]) or capacity
local last_refill = tonumber(data[2]) or now

-- 補 token
local elapsed = now - last_refill
tokens = math.min(capacity, tokens + elapsed * refill_rate)

-- 扣 token
if tokens >= 1 then
  tokens = tokens - 1
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  return 1  -- 放行
else
  return 0  -- 擋
end
```

`EVAL` 這段 script，Redis 在 single-threaded event loop 裡一口氣跑完。讀、算、寫之間不會有別的 request 插進來。

### Sliding Window：精確計數

限制：1 分鐘最多 10 個 request。把每個 request 的 timestamp 記下來，數 window 內有幾個。

```text
past ──────────────────────────→ now
         ←─── 60 秒 window ───→
       ts=30  ts=45  ts=55  ts=59  ts=60
         ●      ●      ●      ●     ?  ← 放不放？
         └─────────────────────────┘
           window 內 4 個，< 10 → 放行
```

Redis 用 Sorted Set，score 放 timestamp，天然按時間排序。跟 Token Bucket 一樣，清過期、數數量、加新的，這三步要綁成一個原子操作，否則兩個 request 同時數到 count=9 都放行。一樣包成 Lua：

```lua
-- KEYS[1] = rate_limit:user_123
-- ARGV[1] = limit, ARGV[2] = window_ms, ARGV[3] = now_ms, ARGV[4] = request_id
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local request_id = ARGV[4]

-- 清過期
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
-- 數 window 內幾個
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, request_id)
  redis.call('PEXPIRE', key, window)
  return 1  -- 放行
else
  return 0  -- 擋
end
```

`ZREMRANGEBYSCORE` 清掉過期的、`ZCARD` 數還剩幾個、`ZADD` 加進新的。每個 request 都記，不允許 burst。

### 怎麼選

| 維度 | Token Bucket | Sliding Window |
|---|---|---|
| 精確度 | 近似（允許 burst） | 精確（每 req 都記）|
| 空間 | O(1) 一個 hash | O(N) window 內 N 筆 |
| Burst 行為 | 允許 | 嚴格禁止 |
| 適合 | API：用戶偶爾 burst 是正常的 | 計費合約：嚴格上限不能超 |

---

## 多台 app server 時 counter 放哪

把 counter 放在本地記憶體，一台機器算得準。可是一旦前面加了 load balancer、請求被分到好幾台，每台如果「只」看到自己那份，就不準確了。

```text
        Load Balancer (round-robin)
        ┌───┬───┬───┬───┐
        ▼   ▼   ▼   ▼   ▼
      app1 app2 app3 app4
       10   10   10   10   ← 各自記憶體，各算各的
```

User 上限 10 req/s，4 台 app。LB round-robin，每台只看到 `40 / 4 = 10` 個，判定沒超過。實際放行 40 個，超過上限 4 倍。

counter 不能放各自的記憶體，要全部打同一個 Redis，大家看同一份數字。代價是每個 request 多 1-2ms 的 Redis round-trip。

---

## Redis 自己也有上限

Redis 單機簡單操作大約十萬次量級（官方 benchmark 沒開 pipeline 約 18 萬，這裡抓 10 萬當保守估）。Rate limit 每次檢查要 3-4 個 op（讀、算、寫）。有效上限打折。

### 瓶頸一：QPS 超過單機

假設 500,000 次 rate limit 檢查/sec，每次 3 op = 1,500,000 ops/sec。單機 100,000，差 15 倍。

解法：Redis Cluster，`hash(user_id) mod N` 分散。需要 `ceil(1,500,000 / 100,000) × 1.5 ≈ 23` 台。

### 瓶頸二：Latency 佔比太高

API latency 目標 5ms，Redis round-trip 1.5ms，光「檢查能不能跑」就吃掉 30%。

解法：本地 cache + 週期同步。每台 app 記憶體存最近值，每 100ms 跟 Redis 同步。Rate limit check 從 1.5ms 降到 <0.01ms。代價：100ms 內最多誤判 `QPS × 0.1` 個 request，用精確度換 latency。

### 瓶頸三：[Hot key](chunk://rate-limiter)

先分清楚兩種 Redis key。Per-user key（`rate_limit:user_123`）天然分散，不同 user_id 是不同 key，consistent hashing 自動分到不同 node。Hot key 問題出在**全域 endpoint 限速**（`rate_limit:/search`）。

所有人打 `/search`，rate limiter 都對同一個 Redis key 做 INCR。Consistent hashing 把這個 key 分配到某一台 node。不管 cluster 有 4 台還是 400 台，**一個 key 永遠只落在一台**。那台被壓垮，其他台閒著。

解法是 key splitting，在 app code 裡把一個 key 拆成多個：

```ts
const shardId = Math.floor(Math.random() * 10);  // 0~9
const key = `rate_limit:/search:${shardId}`;
await redis.eval(rateLimitScript, [key], [limit / 10, ...]);
```

拆完的 10 個 key 名字不同，consistent hashing 會把它們分散到不同 node。原本一台扛全部，現在多台各扛一份。

查總量時加總：

```ts
const counts = await Promise.all(
  Array.from({ length: 10 }, (_, i) =>
    redis.zcard(`rate_limit:/search:${i}`)
  )
);
const total = counts.reduce((a, b) => a + b, 0);
```

兩步驟的分工：**key splitting 把 1 個 key 變成 N 個 key（app code 做），consistent hashing 把 N 個 key 分配到不同 node（Redis cluster 做）。** 缺了第一步，第二步沒有意義，1 個 key 進 consistent hashing 只會出 1 台。

代價：隨機分配可能某個 shard 瞬間集中，全域總量沒超但單一 shard 超了，用近似值換分散。

---

## Rate Limiter 和 Bloom Filter：不同層的防禦

```text
    request 進來
        │
        ▼
┌───────────────┐
│  Rate Limiter │─擋→ 429（打太多）
└───────┬───────┘
        │ 放行
        ▼
┌───────────────┐
│     Cache     │
└───────┬───────┘
        │ miss
        ▼
┌───────────────┐
│ Bloom Filter  │─no→ 404（key 不存在）
└───────┬───────┘
        │ maybe
        ▼
┌───────────────┐
│      DB       │
└───────────────┘
```

[Rate limiter](chunk://rate-limiter) 擋「合法但太多」的人。[Bloom filter](chunk://bloom-filter) 擋「一直打不存在的 key、穿過 cache 直接打到 DB」的人。位置不同、對付的東西也不同，所以不能互換。

---

## 跟前兩篇的對照

| | Cache（擋讀） | Queue（擋寫） | Rate Limiter（擋人） |
|---|---|---|---|
| 保護什麼 | DB 不重複讀 | DB 不被寫入尖峰壓垮 | 所有資源不被單一 client 耗盡 |
| 失效時 | 雪崩 / 穿透 / 擊穿 | 消息丟失 / 重複消費 | 濫用者壓垮全系統 |
| 在哪裡 | App ↔ DB 之間 | App ↔ DB 之間 | 最前面，進 App 之前 |
| 核心選擇 | [Cache 策略](chunk://cache-strategies) | ack + commit + [冪等](chunk://idempotency) | Key 選擇 + 演算法選擇 |

三篇都是同一個故事的不同面向：**在壓力源和資源之間放一層 buffer**。Cache 吸收重複讀取，queue 攤平寫入尖峰，rate limiter 在最外圈把不該進來的量擋掉。

---

## 決策場景

你是一個 SaaS 平台的後端 lead。API 開放給第三方，免費方案和付費方案共用同一組 server。某天凌晨兩點，免費方案的某個用戶寫了腳本瘋狂打你的 API，付費客戶的 response time 從 50ms 飆到 3 秒。

第一步：加 rate limiter，key 用 API key。免費 100 req/min，付費 10,000 req/min。Token bucket，因為正常用戶會 burst。

上線一個月，客服收到投訴：「我們公司明明沒超量，為什麼被擋？」查 log 發現他們 50 台 server 用同一個 API key，每台 200 req/min，合計 10,000 剛好踩線。Token bucket 的 burst 讓他們偶爾瞬間超過。

調整：把 key 改成 API key + source IP 雙層。全域限 10,000/min 的同時，單一來源限 500/min，避免某台 server 吃掉全部 quota。

### Regret condition

Token bucket 允許 burst，對 API 場景幾乎都適合。但如果你的下游有嚴格合約（例如第三方 API 按次計費，超過要付錢），burst 會讓你偶爾超額。這時要換 sliding window，或至少在計費路徑上加一層精確計數。

---

## References

- [Redis benchmark（官方吞吐數據）](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/benchmarks/) — 沒開 pipeline 簡單 GET/SET 約 18 萬 req/s，開 `-P 16` pipeline 可破百萬
