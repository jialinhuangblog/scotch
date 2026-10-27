---
title: "Which algorithm and which key should a rate limiter use?"
slug: rate-limiter
subtitle: "Token Bucket allows bursts, Sliding Window counts strictly. Picking the wrong key causes more trouble than picking the wrong algorithm."
chapter: "buffer"
tags: [rate-limiter, redis, token-bucket, sliding-window, system-design-interview]
date: 2026-04-17
related: [cache-hot-key, queue-peak-shaving, scaling-first-move]
---

# Which algorithm and which key should a rate limiter use?

[Cache](article://cache-hot-key) handles reads and the [queue](article://queue-peak-shaving) handles writes. Both absorb traffic on behalf of the DB. They deal with the amount of traffic. A rate limiter looks at which client is sending too much.

One user sends ten thousand requests a second and everyone else is stuck. No cache is big enough and no queue is deep enough. One person uses up the resources, and for everyone else the system is as good as down. A rate limiter decides **whether this client's request should go through**.

```text
Normal:
  User A 10 req/s → allowed → cache → DB

Abuse:
  User B 10,000 req/s → Rate Limiter → 429 Too Many Requests
  other users unaffected
```

---

## Which key matters more than which algorithm

The same 10,000 req/s can mean completely different things.

| Situation | Key | Limit it? |
|---|---|---|
| one user sends 10,000/s | user_id | limit |
| 1,000 users send 10/s each | user_id | do not limit (everyone is normal)|
| anonymous traffic | IP | depends on the situation |
| a third party calls the API | API key | limit (protect the quota)|

The key decides "who is counted separately from whom". Pick the wrong key, and the client that should be limited never is.

Using the IP as the key in a corporate setting looks reasonable, but a whole building may share one NAT IP, and limiting one IP then limits two thousand people. This is more a business judgment and has little to do with which algorithm is used.

---

## The two common approaches: token and sliding window

### Token Bucket: bursts allowed

Picture a bucket. Every second a fixed number of tokens drops into it, up to a capacity limit. A request takes one token on the way in. No token, request refused.

```text
bucket capacity = 10
refill rate refill_rate = 5/sec

  time=0        time=1        time=2
  ┌────────┐   ┌────────┐   ┌────────┐
  │ 10/10  │   │ 10/10  │   │  7/10  │
  └────────┘   └────────┘   └────────┘
  full          +5 but full   3 used
```

A user stays quiet for 30 seconds and the bucket refills. The next second they send 10 in a row, all allowed. This burst is normal. A real human clicks once, rests a moment, comes back and clicks several times.

Redis stores a hash:

```text
Key: rate_limit:user_123
Value: { tokens: 7, last_refill: 1700000000 }
```

Each request computes the elapsed time, refills tokens and deducts one. But read, compute and write are three steps, and they are not atomic.

```text
Request A                          Request B
  │                                  │
  ├─ read tokens = 1                 │
  │                                  ├─ read tokens = 1
  ├─ tokens >= 1 → allow             │
  ├─ write tokens = 0                ├─ tokens >= 1 → allow
  │                                  ├─ write tokens = 0
  ▼                                  ▼
  Both allowed. 2 requests went through, the bucket had only 1 token.
```

The fix is to write the whole logic as one script and send it to Redis, so Redis runs it in one go on the server side and no other request can cut in between. Redis writes this kind of server side script in Lua:

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

-- refill tokens
local elapsed = now - last_refill
tokens = math.min(capacity, tokens + elapsed * refill_rate)

-- take a token
if tokens >= 1 then
  tokens = tokens - 1
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  return 1  -- allow
else
  return 0  -- reject
end
```

Send the script with `EVAL`, and Redis runs it in one go inside its single threaded event loop. No other request gets between the read, the compute and the write.

### Sliding Window: exact counting

Limit: at most 10 requests per minute. Record the timestamp of every request and count how many fall inside the window.

```text
past ──────────────────────────→ now
         ←── 60 second window ──→
       ts=30  ts=45  ts=55  ts=59  ts=60
         ●      ●      ●      ●     ?  ← allow or not?
         └─────────────────────────┘
           4 in the window, < 10 → allow
```

Redis uses a Sorted Set with the timestamp as the score. A Sorted Set is ordered by score, which here means ordered by time. As with the Token Bucket, clearing expired entries, counting and adding the new one have to be bound into one atomic operation, otherwise two requests both count 9 and both go through. Same as before, wrapped in Lua:

```lua
-- KEYS[1] = rate_limit:user_123
-- ARGV[1] = limit, ARGV[2] = window_ms, ARGV[3] = now_ms, ARGV[4] = request_id
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local request_id = ARGV[4]

-- clear expired entries
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
-- count how many are in the window
local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, request_id)
  redis.call('PEXPIRE', key, window)
  return 1  -- allow
else
  return 0  -- reject
end
```

`ZREMRANGEBYSCORE` clears the expired entries, `ZCARD` counts what is left, `ZADD` adds the new one. Every request is recorded. No bursts allowed.

### How to choose

| Dimension | Token Bucket | Sliding Window |
|---|---|---|
| Precision | approximate (bursts allowed) | exact (every req recorded)|
| Space | O(1), one hash | O(N), N entries in the window |
| Burst behavior | allowed | strictly forbidden |
| Fits | APIs: an occasional user burst is normal | billing contracts: a strict cap that must not be exceeded |

---

## Where the counter lives with several app servers

Keep the counter in local memory and one machine counts correctly. But once a load balancer in front spreads requests over several machines, each one sees "only" its own share, and the total is undercounted.

```text
        Load Balancer (round-robin)
        ┌───┬───┬───┬───┐
        ▼   ▼   ▼   ▼   ▼
      app1 app2 app3 app4
       10   10   10   10   ← each in its own memory, each counting alone
```

A user's limit is 10 req/s, with 4 app servers. The LB round-robins, each server sees only `40 / 4 = 10` and decides the limit is not exceeded. 40 requests actually go through, 4 times the limit.

The counter cannot live in each server's own memory. Every server has to go to the same Redis and read the same number. The cost is an extra 1-2ms Redis round-trip per request.

---

## Redis has a ceiling too

A single Redis node handles simple operations on the order of a hundred thousand per second (the official benchmark without pipelining is about 180k; this article uses 100k as a conservative estimate). Each rate limit check takes 3-4 ops (read, compute, write), so the number of checks it can actually handle is roughly the op count divided by 3 to 4.

### Bottleneck one: QPS beyond a single node

Suppose 500,000 rate limit checks/sec, at 3 ops each = 1,500,000 ops/sec. A single node does 100,000, a 15x gap.

Fix: Redis Cluster, spread with `hash(user_id) mod N`. Needs `ceil(1,500,000 / 100,000) × 1.5 ≈ 23` nodes.

### Bottleneck two: latency share too high

The API latency target is 5ms, and the Redis round-trip is 1.5ms. Just "checking whether it may run" takes 30%.

Fix: local cache + periodic sync. Each app server keeps the latest value in memory and syncs with Redis every 100ms. The rate limit check drops from 1.5ms to <0.01ms. Cost: within any 100ms at most `QPS × 0.1` requests are misjudged. Precision traded for latency.

### Bottleneck three: [Hot key](chunk://rate-limiter)

Per-user keys (`rate_limit:user_123`) are spread out by nature. Different user_ids are different keys, and consistent hashing places them on different nodes by itself. The hot key problem shows up with **a global rate limit on an endpoint** (`rate_limit:/search`).

Everyone hits `/search`, and the rate limiter runs INCR on the same Redis key for all of them. Consistent hashing assigns that key to one node. Whether the cluster has 4 nodes or 400, **one key always lands on one node**. That node is saturated, the others sit idle.

The fix is key splitting: in app code, split one key into many:

```ts
const shardId = Math.floor(Math.random() * 10);  // 0~9
const key = `rate_limit:/search:${shardId}`;
await redis.eval(rateLimitScript, [key], [limit / 10, ...]);
```

The 10 split keys have different names, so consistent hashing spreads them over different nodes.

To read the total, sum them:

```ts
const counts = await Promise.all(
  Array.from({ length: 10 }, (_, i) =>
    redis.zcard(`rate_limit:/search:${i}`)
  )
);
const total = counts.reduce((a, b) => a + b, 0);
```

The division of work between the two steps: **key splitting turns 1 key into N keys (done in app code); consistent hashing assigns N keys to different nodes (done by the Redis cluster).** Without the first step the second means nothing. 1 key into consistent hashing comes out on 1 node.

Cost: random assignment can concentrate on one shard for a moment, so the global total is under the limit but a single shard is over. An approximation traded for spreading the load.

---

## Rate Limiter and Bloom Filter: defenses at different layers

```text
    request arrives
        │
        ▼
┌───────────────┐
│  Rate Limiter │─reject→ 429 (too many)
└───────┬───────┘
        │ allowed
        ▼
┌───────────────┐
│     Cache     │
└───────┬───────┘
        │ miss
        ▼
┌───────────────┐
│ Bloom Filter  │─no→ 404 (key does not exist)
└───────┬───────┘
        │ maybe
        ▼
┌───────────────┐
│      DB       │
└───────────────┘
```

The [rate limiter](chunk://rate-limiter) sits at the very front and limits each client's request volume. The [Bloom filter](chunk://bloom-filter) sits in front of the DB and filters out keys that do not exist. They solve different problems, so one cannot replace the other.

---

## Compared with the previous two articles

| | Cache (reads) | Queue (writes) | Rate Limiter (single client) |
|---|---|---|---|
| Protects | the DB from repeated reads | the DB from handling a write peak at once | every resource from being used up by one client |
| When it fails | avalanche / penetration / stampede | lost messages / duplicate consumption | one abuser uses up every resource |
| Where | between App and DB | between App and DB | at the very front, before the App |
| Core choice | [Cache strategy](chunk://cache-strategies) | ack + commit + [idempotency](chunk://idempotency) | key choice + algorithm choice |

---

## A decision scenario

A SaaS platform opens its API to third parties. The free plan and the paid plan share the same servers. One day at 2am, a free plan user writes a script that calls the API nonstop, and paid customers' response time climbs from 50ms to 3 seconds.

Step one: add a rate limiter, keyed on the API key. Free: 100 req/min. Paid: 10,000 req/min. Token bucket, because normal users burst.

A month after launch, support receives a complaint: "Our company is clearly under the quota, why are we blocked?" The logs show their 50 servers share one API key, each at 200 req/min, 10,000 in total, right at the line. The token bucket's burst lets them go over for a moment now and then.

Adjustment: change the key to two layers, API key + source IP. Keep the global limit of 10,000/min, and limit a single source to 500/min, so one server cannot use up the whole quota.

### When would they regret it

A token bucket allows bursts, which suits almost every API scenario. But if there is a strict contract downstream (for example a third party API billed per call, with charges for going over), bursts push usage over the limit now and then. Then switch to sliding window, or at least add a layer of exact counting on the billing path.

---

## References

- [Redis benchmark (official throughput numbers)](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/benchmarks/): about 180k req/s for simple GET/SET without pipelining, over a million with `-P 16` pipelining
