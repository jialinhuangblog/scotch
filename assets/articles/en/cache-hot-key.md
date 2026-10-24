---
title: "The cache is fine, until everyone asks for the same key in the same second"
slug: cache-hot-key
subtitle: "Cache avalanche, penetration, stampede. Three ways a request gets no answer from the cache and lands on the DB, and how to protect the DB."
chapter: "buffer"
tags: [cache, redis, bloom-filter, singleflight, cache-strategies]
date: 2026-03-31
updated: 2026-10-17
revisions: 2
related: [queue-peak-shaving, rate-limiter, scaling-first-move, search-cache, cap-cache-acid]
---

# The cache is fine, until everyone asks for the same key in the same second

A cache sits in front of the DB. Any request the cache can answer never reaches the DB.

Most days nobody thinks about it. It has been a best practice for years, the framework wraps it, you paste a config and it runs. Unless you have to write one from scratch, or it fails at 3am, it is hard to really know which requests it spares the DB from, and when that protection stops.

```text
Normal:
user → Redis (hit) → return data. DB untouched.

Cache miss:
user → Redis (miss) → DB → DB overloaded → whole system down
```

---

## 雪崩, 穿透, 擊穿, and their English names

The clean three-way split of 雪崩, 穿透 and 擊穿 comes from the Simplified Chinese interview scene. Traditional Chinese never grew its own terms, so this article uses the English ones. But the English boundaries are blurrier than the Chinese.

- **Cache stampede**: one popular key expires and a flood of requests reaches the DB at the same moment. Wikipedia lists **dog-piling** as an alias. **Thundering herd** is often used too, but it is broader: it means a crowd of processes waking at once, and a cache stampede is only one case. In practice the two are swapped freely. The Chinese interview scene calls it 擊穿.
- **Cache avalanche**: many keys expire at the same time. In English it is often mixed up with stampede, because the result is the same (the DB gets a burst of requests). The only difference is whether one key expired or a batch did. In Chinese, 雪崩.
- **Cache penetration**: a lookup for a key that exists in neither the cache nor the DB. English discussion usually centers on the fix, called **negative caching**. In Chinese, 穿透.
- **Hot key** (or hotspot): unlike the first three, nothing expires. Traffic just concentrates on one key.

So in English engineering practice the line between avalanche and stampede is blurry. The clean three-way cut is a line drawn for teaching and interviews. They are still covered separately below, because they happen under different conditions and the fixes differ.

---

## Cache Avalanche: a batch of keys expires at the same time

A batch of product records is written into the cache at once, all with a 30 minute TTL. 30 minutes later 100,000 entries expire together, the cache is empty in an instant, and every request lands on the DB.

```text
00:00  batch write 100k entries, TTL = 30min
00:30  100k entries expire together
         → every cache lookup misses
         → DB load spikes
```

The problem is a fixed TTL. Keys written together with the same TTL expire in the same second.

### Defense: spread the expiry times

Add a random value to the TTL. Simplest, and the most effective.

```text
TTL = 30min + random(0~5min)

key A expires at: 30:00
key B expires at: 32:17
key C expires at: 34:45
key D expires at: 30:52
```

100,000 entries now expire over 5 minutes, and the DB sees only a few hundred misses per second.

Other defenses:

| Method | How | Fits |
|---|---|---|
| TTL plus random | expiry spread out | every scenario; this should be the default |
| Never expire plus background refresh | a worker updates the cache on a schedule | data with a predictable update rhythm |
| Multi-level cache | local L1 plus Redis L2 | high availability; the local cache survives a Redis outage |
| Rate limiting | cap DB concurrency on cache miss | the last line of defense |

---

## Cache Penetration: repeated lookups for a key that does not exist

The key does not exist at all. The cache does not have it, the DB does not either, and every lookup wastes both layers.

This differs from avalanche. In an avalanche the data exists and the cache is only empty for a moment. In penetration, someone keeps asking for keys that never existed. The DB finds nothing, so there is no value to write back into the cache, and the same key misses and reaches the DB on every lookup.

```text
attacker queries id = -1, -2, -3, ...
  → cache: nothing (it never stored something that does not exist)
  → DB: nothing (these ids do not exist)
  → every request penetrates to the DB
  → enough volume and the DB goes down
```

### Defense one: record "does not exist" too (cache the null)

When the DB finds nothing, write that into the cache as well.

```text
query id=-1 → DB has nothing → SET cache("user:-1", null, TTL=5min)

query id=-1 again within 5 minutes → cache hit (value is null) → answer "not found" directly
```

Simple, but an attacker who changes the id every time (-1, -2, -3...) forces one null entry per id, and the cache fills with nulls fast.

### Defense two: filter with a Bloom Filter first

Add one more layer before the cache and the DB. With very little memory it can say "this key definitely does not exist".

```text
request arrives
  → Bloom filter: id=-1 definitely does not exist → return 404
     no cache lookup, no DB lookup, zero cost

  → Bloom filter: id=42 might exist → go on to the cache → ...
```

The Bloom filter's guarantee is one-sided:

- **"Does not exist" is certain.** If the filter says no, it is really not there, 100%, and skipping the cache and DB is safe.
- **"Might exist" has a small chance of being wrong (false positive).** Inside, several hash functions map a key onto a bit array. Different keys can collide onto the same bits and make the filter say "exists" by mistake. The request then passes through to the cache and DB, finds nothing, and the only cost is one extra lookup. The answer is never wrong.

A Bloom filter for 1 million keys takes 1.2 MB with a false positive rate under 1%, so out of 100 lookups for missing keys, about 1 is misjudged as "might exist". Caching nulls, by contrast, stores one null per id the attacker tries, and memory grows for as long as the attack runs.

Details in [Bloom Filter](chunk://bloom-filter).

---

## Cache Stampede: everyone grabs the same freshly expired entry

One hot key expires, and a flood of requests arrives at that exact moment.

In an avalanche a whole batch expires together. In a stampede only one key expires, but it happens to be the one everyone wants.

```text
the cache key for the homepage featured product expires
  → 10,000 users request that product at the same time
  → every lookup misses
  → 10,000 requests hit the DB for the same row
  → DB overloaded
```

### Defense one: let one request through at a time (Mutex)

All 10,000 requests miss, but only one goes to the DB. The rest wait.

```text
request A → cache miss → try the lock (SET NX) → got it → query DB → write cache → release lock
request B → cache miss → try the lock → failed → sleep 50ms → read cache again → found
request C → cache miss → try the lock → failed → sleep 50ms → read cache again → found
...
request 10000 → same
```

10,000 requests, 1 reaches the DB, and the other 9,999 wait an extra 50 to 100ms.

The distributed lock is Redis `SET` with `NX` (only set if Not eXists). The older `SETNX` command also means "set only if absent", but it cannot set an expiry at the same time, so today everyone uses `SET ... NX EX`:

```text
SET lock:hot-item 1 NX EX 5
    ^^^^^^^^^^^^^^ ^ ^^ ^^ ^
    key            value | |  seconds until expiry
                         | EX = Expire (seconds)
                         NX = set only if the key does not exist

key    → your own name; the lock: prefix is a convention meaning "this is a lock"
value  → 1 for now; the code below swaps in a token
NX     → only checks whether the key exists
EX 5   → delete the key after 5 seconds, so a dead lock holder cannot jam the lock forever
```

```text
SET lock:hot-item 1 NX EX 5    → key absent → set, lock acquired
SET lock:hot-item 1 NX EX 5    → key present → nothing happens, someone else is already querying
```

As a function (Node):

```ts
async function getWithLock(key: string): Promise<any> {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const token = crypto.randomUUID();
  // NX = set only if absent, EX 5 = expire in 5s, so a dead lock holder cannot jam the lock
  const locked = await redis.set(`lock:${key}`, token, 'NX', 'EX', 5);

  if (locked) {
    try {
      const data = await db.query(key);               // only I hit the DB
      await redis.set(key, JSON.stringify(data), 'EX', 1800);
      return data;
    } finally {
      await releaseLock(`lock:${key}`, token);
    }
  }

  // did not get the lock: wait and read the cache again; the first retry usually finds it
  await sleep(50);
  return getWithLock(key);
}
```

Releasing the lock cannot be a plain `DEL`. If A runs long enough for its lock to expire and B acquires it, A's `DEL` on return would delete B's lock. So the value is a token of your own, and before deleting you confirm the lock is still yours. The compare and the delete have to run atomically, so this is Lua:

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

### Defense two: dedup inside one machine first (Singleflight)

The mutex works across machines. Singleflight dedups inside one machine. The implementation is a Map holding the Promises that are still in flight:

```ts
const inflight = new Map<string, Promise<any>>();

async function singleflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing;          // someone is already querying; wait on the same Promise

  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
```

3000 concurrent requests for the same key on one server, and `fn()` runs once. The other 2999 await the same Promise. It needs no network call at all, which is why it goes first.

```text
Mutex (distributed):
  Servers A, B, C together → only 1 queries the DB

Singleflight (single machine):
  100 goroutines inside Server A → only 1 queries the DB
  100 goroutines inside Server B → only 1 queries the DB
  → still 2 requests reach the DB (one per server)
```

Singleflight costs almost nothing (an in-memory map plus a mutex). The distributed lock costs one extra Redis call. In practice you do both, singleflight first, then the lock:

```text
10,000 requests arrive at once (spread over 3 servers)

Server A (3000 requests)
  → singleflight: 3000 in, 1 out, the rest wait
Server B (4000 requests)
  → singleflight: 1 out
Server C (3000 requests)
  → singleflight: 1 out

→ 3 requests left, all check the cache → all miss
→ Redis SET NX for the lock → 1 goes to the DB, 2 wait
→ write cache → each server's singleflight hands the result to its waiting requests
```

Why not the other way round? If the Redis lock came first, all 10,000 requests would hit Redis to compete for it, and Redis itself would overload first. Merging 99% of the duplicates locally with singleflight leaves only a few that need the cross-machine lock.

Chaining the two layers is one line:

```ts
const item = await singleflight('hot-item', () => getWithLock('hot-item'));
```

Go ships this as `golang.org/x/sync/singleflight`. Equivalents elsewhere:

| Language | Implementation |
|---|---|
| Go | `singleflight.Group.Do()` |
| Java | Guava `Cache.get(key, loader)` dedups by itself |
| Node.js | a Map of pending Promises, shared by key |
| Nginx | `proxy_cache_lock on` |

The general name is **request coalescing**. Singleflight is what the Go community calls it.

### Defense three: never let it expire (no TTL plus background refresh)

The key gets no TTL. A separate worker fetches fresh data from the DB on a schedule and updates the cache.

```text
cache("hot-item", data, TTL=never)

background worker every 30 seconds:
  → query DB for the latest data
  → update cache("hot-item", newData)
```

The key never expires, so every request hits the cache and none waits on the DB.

The cost: data lags by up to 30 seconds (whatever the refresh interval is), there is a worker to maintain, and you have to know in advance which keys are hot. It fits homepage recommendations and leaderboards, where the update rhythm is predictable.

### Mutex plus singleflight as the default, background refresh for extreme QPS

| Method | Latency | Freshness | Complexity | Fits |
|---|---|---|---|---|
| Mutex | waiting requests add 50 to 100ms | high (a miss fetches the latest from the DB) | low | most scenarios |
| Singleflight | almost none | high | very low | paired with the mutex, as the first line |
| Background refresh | none | low (one refresh interval behind) | high | extreme QPS that tolerates lag |

---

## Hot Key: every request lands on one key

The three above are all cache failures. There is one more case where the cache never fails and every lookup hits, but everyone wants the same entry at the same time, and that entry lives on a single Redis node.

```text
user:123456:profile is read 500,000 times per second
  → the hash slot (Redis Cluster uses CRC16 over 16384 slots) maps this key to node-3
  → node-3 CPU at 100%
  → every other key on node-3 slows down too
```

### Fix: split one key into many (key shard)

Split the key into N copies spread over different nodes.

```text
user:123456:profile:0
user:123456:profile:1
...
user:123456:profile:9
```

On read, pick one with `random(0, 9)`. The hash slots map the 10 keys to different nodes, and the traffic spreads out.

On write, every shard has to be updated, so writes cost N times more. Hot key scenarios are almost all reads, so the trade is worth it.

```text
shards    read traffic spread   write cost
10        ÷10                   ×10
```

---

## The three failures side by side

In all three, a request the cache did not answer goes straight to the DB.

| | Where it happens | What is being fixed | How |
|---|---|---|---|
| Avalanche | many keys expire at the same moment | time | spread the expiry times |
| Penetration | the key does not exist, so the cache can never hold it | the entrance | filter out lookups for missing keys |
| Stampede | one hot key that just expired | concurrency | let one request reach the DB at a time |

---

## How data gets into the cache in the first place

This article covers protecting the DB when the cache fails. How data first gets into the cache, and when it is updated, is in [Cache Strategies](chunk://cache-strategies).

---

## References

- [Cache stampede](https://en.wikipedia.org/wiki/Cache_stampede)
- [Thundering herd problem](https://en.wikipedia.org/wiki/Thundering_herd_problem)
- [golang.org/x/sync/singleflight](https://pkg.go.dev/golang.org/x/sync/singleflight)
