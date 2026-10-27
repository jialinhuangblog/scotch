---
title: "Cache Stampede"
slug: cache-stampede
brief: "Avalanche, penetration, stampede: three ways requests get past the cache and land on the DB, each with its own fix."
date: 2026-07-20
updated: 2026-07-20
revisions: 1
article: cache-hot-key
---

# Three ways a cache fails

The cache sits in front of the DB to absorb traffic. When the cache has no answer, every request lands on the DB, and once past its limit it goes down. Three scenarios, by trigger.

## Avalanche (Cache Avalanche)

A large number of keys expire at the same time, and the requests all pass through the cache and hit the DB at once.

```text
00:00  batch write 100k cache entries, all with TTL 30 minutes
00:30  100k entries expire at the same time
       → 100k requests miss the cache at once
       → all hit the DB
       → DB cannot take the load and goes down
```

The common cause is a TTL set to the same fixed value.

**Fixes**:

| Method | How |
|---|---|
| Add jitter to TTL | `TTL = 30min + random(0~5min)`, so expiry times spread out |
| Never expire + background refresh | no TTL on the cache; a separate worker updates it periodically |
| Layered cache | local cache (L1) + Redis (L2); when Redis misses, the local cache is still there |
| Rate limit | on a cache miss, cap the number of concurrent requests to the DB |

**L1 / L2 have nothing to do with CPU cache**. Here L1 = **the local cache inside the app process** (Node.js `Map`, Java Caffeine, Go bigcache and the like, ~100 ns access), L2 = **the remote shared cache** (Redis / Memcached, ~500 μs access including network). Only the naming is borrowed from CPU cache, where the closer level is the faster one.

L1 answers the hottest requests (hits inside one process, no network), L2 handles the traffic that misses L1 (shared across servers). During an avalanche, even if a large number of Redis keys expire, L1 still has a chance to hit, so not everything passes through to the DB.

The price is that L1 consistency is hard, because every app server has its own copy. After a DB update, invalidation relies on a short TTL or a pub/sub notice. So L1 usually holds only data that can be stale for a few seconds (settings, catalogs, enums), and sensitive data (stock, balances) uses L2 only.

## Penetration (Cache Penetration)

The queried key does not exist at all. Not in the cache, not in the DB. Every query wastes both layers.

```text
attacker keeps querying the user with id=-1
  → not in cache (never stored)
  → not in DB either (the data does not exist)
  → passes through to the DB every time
  → with enough volume, the DB goes down
```

Avalanche is data that expired. Penetration is data that never existed.

**Fixes**:

| Method | How |
|---|---|
| Cache the null | when the DB finds nothing, still write `cache("user:-1", null, TTL=5min)` so the DB is not queried again for a while |
| Bloom filter | check the bloom filter first; on "definitely absent" return directly, with no DB and no cache lookup. See [Bloom Filter](chunk://bloom-filter) |

With null caching, each nonexistent key has to be looked up in the DB once before it is recorded. A Bloom filter does not need that. With very little memory (10 bit per key) it filters out queries that are "definitely absent", with a false positive rate under 1%.

## Stampede

The moment a single hot key expires, a flood of requests arrives at once.

```text
the cache key for the homepage featured product expires
  → 10k users request this product at the same time
  → all miss the cache
  → 10k requests query the DB for the same row at once
  → DB load too high
```

Avalanche is many keys expiring at once. Stampede is one key expiring, but it is too popular.

**Fixes**:

| Method | How |
|---|---|
| Singleflight | dedup at the single machine level: duplicate requests inside one server let only one go out, the rest wait for its result |
| Mutex lock | across machines: the first request to miss grabs the lock and queries the DB; the others wait until it writes back to the cache, then read |
| Never expire + background refresh | no TTL on the hot key; a background worker updates it periodically |
| Warm up | load hot data into the cache at startup, instead of waiting for the first miss |

When doing both layers, the order is fixed: singleflight first, then the lock. Otherwise ten thousand requests all go to Redis to fight for the lock, and Redis overloads first. The full walkthrough is in the Read more article.

The mutex logic (Redis grabs the lock with `SET ... NX EX`; the old `SETNX` command cannot set an expiry at the same time):

```text
GET cache("hot-item") → miss
  → SET lock("hot-item") NX EX 5 → success, lock acquired
    → query DB → write back to cache → release lock
  → SET lock("hot-item") NX EX 5 → fails, someone else is already querying
    → sleep 50ms → retry GET cache("hot-item") → it is there
```

## The three side by side

| Name | Trigger | Core fix |
|---|---|---|
| Avalanche | many keys expire at once | add jitter to TTL |
| Penetration | the key does not exist | [Bloom filter](chunk://bloom-filter) |
| Stampede | a single hot key expires | mutex lock |

Cache read and write strategies are in [Cache Strategies](chunk://cache-strategies).
