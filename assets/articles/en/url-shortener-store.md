---
title: "2 billion short link mappings fit in one DB. Why shard at all?"
slug: url-shortener-store
subtitle: "Storage strategy for a read-heavy system. Every cache layer exists so the next layer is never touched."
chapter: "url-shortener"
tags: [url-shortener, sharding, consistent-hashing, cache, redis]
date: 2026-03-21
updated: 2026-10-17
revisions: 1
related: [url-shortener-key, url-shortener-read, url-shortener-demo]
---

# 2 billion short link mappings fit in one DB. Why shard at all?

The [previous article](article://url-shortener-key) covered how the key is generated. Now there are billions of short_key → long_url mappings. 1 million new ones per day, about 2 billion after five years.

Where does this data live? How is it read fast?

---

## Schema

The most basic table:

```sql
CREATE TABLE url_mappings (
  short_key   VARCHAR(7)  PRIMARY KEY,
  long_url    TEXT        NOT NULL,
  user_id     BIGINT,
  created_at  TIMESTAMP   DEFAULT now(),
  expires_at  TIMESTAMP
);
```

Read: `SELECT long_url FROM url_mappings WHERE short_key = ?`
Write: `INSERT INTO url_mappings (short_key, long_url, ...) VALUES (?, ?, ...)`

Point lookup by primary key. The best case for a B-Tree. As long as one machine can carry the read QPS, this is enough.

---

## The read-heavy math

A short URL service has one defining trait: created once, redirected countless times.

```text
Assume:
  1 million new short URLs per day (writes)
  each short URL is clicked 100 times on average (reads)
  read:write ratio = 100:1

  write QPS = 1,000,000 / 86,400 ≈ 12/s
  read QPS = 12 × 100 = 1,200/s
  peak read QPS = 1,200 × 5 = 6,000/s
```

12 QPS of writes is far below what a single MySQL can take. 6,000 QPS of reads, a single machine handles too. But if the service grows to 100 million new URLs per day, peak read QPS becomes 600,000, and one machine cannot handle that.

---

## Step one: add a cache

The standard move for a read-heavy system is Redis in front of the DB.

### Cache-Aside pattern

```text
read short_key = "Xk9mP2q"
  → check Redis
    ├─ hit → return long_url (DB untouched)
    └─ miss → query DB → write to Redis → return long_url
```

Caching works especially well for short URLs. Why:

1. **The value never changes.** Once a short_key is mapped to a long_url, it is never modified. There is no cache and DB inconsistency problem.
2. **Hot keys concentrate.** Most traffic goes to a small number of popular short URLs. 20% of the URLs carry 80% of the traffic, so the cache hit rate is very high.
3. **The value is small.** One mapping is one string (the short key) to one string (the URL). Redis can hold hundreds of millions of them.

### Estimating the cache size

```text
assume the cache holds 20% of the URLs (the popular ones)
2 billion × 20% = 400 million entries
per entry: key 7 bytes + URL 200 bytes on average + overhead ≈ 300 bytes
400 million × 300 bytes = 120 GB
```

120 GB still fits in one Redis with a lot of memory, but in practice a Redis Cluster spreads it out, which is more flexible. Sharding the cache layer and sharding the DB layer are separate problems, and each can scale on its own.

### TTL strategy

The short URL itself has an `expires_at`. The cache TTL does not need to line up with the URL's expiry, because the cache TTL exists to control memory use.

```text
common practice: cache TTL = 24 hours
  → a URL not accessed for 24 hours expires on its own
  → the next access reloads it from the DB
```

An expired URL (`expires_at < now()`) found in the DB returns 404 directly and is not written to the cache, so expired URLs do not take up cache space.

---

## Step two: DB sharding

The cache answers over 80% of reads. The DB itself, 2 billion rows and more than 500 GB, fits on one machine. Sharding usually happens because the service grows and the reads and writes that reach the DB exceed what one machine can take. A table so large that backups and maintenance take too long is another reason.

### Shard key: short_key

```text
shard = hash(short_key) % N
```

Why not user_id? Because a redirect request carries only the short_key, not the user_id. Sharded by user_id, a redirect would not know which DB to query.

Sharded by short_key, a redirect computes `hash(short_key) % N` and knows which machine to go to.

### Write routing

When creating a short URL, first generate the short_key (the three methods from the previous article: truncated hash, counter + base62, snowflake + base62), then compute the shard with the same hash and write to that DB.

```text
create:
  short_key = "Xk9mP2q"
  shard = hash("Xk9mP2q") % 4 = 2
  → INSERT INTO shard_2.url_mappings ...

redirect:
  short_key = "Xk9mP2q"
  shard = hash("Xk9mP2q") % 4 = 2
  → SELECT FROM shard_2.url_mappings WHERE short_key = "Xk9mP2q"
```

Reads and writes use the same hash function, so they always land on the same machine.

### Consistent Hashing

The problem with `hash % N`: add one machine, N changes, and a large share of the keys has to move.

Consistent hashing turns the hash space into a ring (see the [consistent-hashing](chunk://consistent-hashing) chunk). Adding one machine affects only a small neighboring segment of the ring, and the amount moved drops from about 80% to about 1/N (20% in the example below).

```text
4 shards, adding a 5th:
  hash % N:            ~80% of keys move
  consistent hashing:  ~20% of keys move
```

Short URL mappings are immutable. Moving them needs no worry about write conflicts. The data just gets copied from the old shard to the new one.

---

## Capacity estimate

Interviewers often ask for an estimate.

```text
Assume:
  1 million new URLs per day
  kept for 5 years
  total = 1 million × 365 × 5 = 1.825 billion ≈ 2 billion rows

per row:
  short_key:   7 bytes
  long_url:    200 bytes on average
  user_id:     8 bytes
  created_at:  8 bytes
  expires_at:  8 bytes
  index overhead: ~50 bytes
  ≈ 280 bytes/row

total storage = 2 billion × 280 bytes ≈ 560 GB

4 shards: 140 GB each. With replication (1 leader + 1 follower) = 8 DB instances.
```

560 GB is not large. For MySQL or PostgreSQL, one machine holds it. Sharding is more about spreading QPS than about capacity.

---

## Cleaning up expired URLs

A URL past its `expires_at` should not keep taking up space.

### Lazy deletion

A redirect that finds `expires_at < now()` returns 404 and deletes that cache entry while it is there. The DB row can be deleted later.

### Background cleanup job

A batch job runs on a schedule:

```sql
-- PostgreSQL has no DELETE ... LIMIT; bound the batch through a subquery
DELETE FROM url_mappings
WHERE ctid IN (
  SELECT ctid FROM url_mappings
  WHERE expires_at < now() - INTERVAL '7 days'
  LIMIT 10000
);
```

The 7 day buffer avoids deleting a URL that just expired and that users might still access. `LIMIT` avoids deleting too much at once and causing lock contention.

---

## Interviewer follow-ups

---

> **"Redis goes down and takes the DB with it. What do you do?"**
>
> This also counts as a **cache avalanche**. The avalanche in [the other article](article://cache-hot-key) is many keys expiring at once. A whole Redis going down has the same result: every request reaches the DB. The DB used to handle only the 20% the cache missed and suddenly gets 100%, so it goes down too.
>
> Three layers of defense, each one behind the last:
>
> 1. **Redis HA** (Sentinel / Cluster): keep Redis from going down in the first place. When the master dies, automatic failover promotes a follower.
> 2. **Local cache** (in-process LRU): with Redis down, a Map in the application's memory can still answer hot keys. No network, a direct read inside the same process, faster than Redis. Each server has its own copy, not shared.
> 3. **Circuit breaker**: when the DB error rate rises, open the circuit automatically, return 503 directly, and stop sending requests to the DB. Let a few requests through on a timer to probe, and close the circuit once the DB recovers. It looks from the application's side at "do my DB calls return normally" (timeout, connection refused, error). It does not need the DB's internal CPU / memory metrics.
>
> ```text
> request → local cache (~100 ns, same process)
>   miss → Redis (~0.5 ms, over the network)
>     miss → circuit breaker → DB (~1-10 ms)
>                              ↑ error rate > 50% opens the circuit, return 503
> ```
>
> With Redis down, the service slows but still answers. With the DB down, nothing can be read or written, and the service stops. So the circuit breaker protects the DB, because there is no layer behind the DB to take over.

---

> **"1 million people click the same short URL at the same time, and the cache just expired. What happens?"**
>
> **Cache stampede / thundering herd**. 1 million requests miss the cache at the same time, query the DB for the same row at the same time, and the DB receives the same query 1 million times.
>
> **Singleflight** (also called request coalescing) handles this. For duplicate queries on the same key, only the first goes to the DB. The rest wait for its result.
>
> ```text
> request 1 → cache miss → query DB
> requests 2~1,000,000 → cache miss → someone is already querying this key → wait
> DB returns → write to cache → everyone gets the same result
> ```
>
> The implementation keeps a Map in the process that records "this key is being queried":
>
> ```go
> // Go — the official package
> import "golang.org/x/sync/singleflight"
>
> var g singleflight.Group
>
> func resolve(shortKey string) (string, error) {
>     val, err, _ := g.Do(shortKey, func() (interface{}, error) {
>         return db.Query(shortKey) // only the first one runs this
>     })
>     return val.(string), err
> }
> ```
>
> ```typescript
> // TypeScript — hand-written, about a dozen lines
> const inflight = new Map<string, Promise<string>>();
>
> async function singleflight(key: string, fn: () => Promise<string>) {
>   if (inflight.has(key)) return inflight.get(key)!; // someone is already querying; wait for them
>   const promise = fn();
>   inflight.set(key, promise);
>   try { return await promise; }
>   finally { inflight.delete(key); }
> }
> ```
>
> This differs from debounce / throttle: debounce delays the trigger, throttle drops the extra requests. Singleflight neither delays nor drops. The first request queries right away, the other requests wait for it to finish, and all share the same result.
>
> Singleflight merges the burst of duplicate queries, the result goes into the cache, and after that it is a normal cache hit.

---

> **"The shard key is short_key. But one shard's URLs are especially popular, with 10 times the traffic of the other shards. How do you handle it?"**
>
> Consistent hashing's virtual nodes (one machine holding several points on the ring) handle uneven data distribution. Hot keys need separate handling. When one URL suddenly becomes popular, whichever shard that key lands on gets 10 times the traffic. Resharding only moves the hot key to another machine, and that machine becomes the hot shard.
>
> The fix is in the cache layer, not the DB layer. Keep the traffic from reaching the DB at all:
>
> ```text
> 1. Redis cache → answers over 80% of reads (there by default)
> 2. Local cache (in-process LRU) → hot keys never even reach Redis. Set the LRU capacity yourself, e.g. 10,000 entries (each entry key 7 bytes + URL ~200 bytes + overhead ~100 bytes ≈ 300 bytes, 10,000 entries ≈ 3 MB). Most traffic concentrates on a few popular URLs (the 80/20 rule), so a small number of entries covers most hot keys
> 3. Redis key replication → store the same entry several times, pick one at random on read, spread the load off a single Redis node
>    (only needed when one key's QPS approaches the single-node Redis limit of ~100,000/s)
> ```
>
> Latency and QPS ceiling per layer:
>
> | Layer | Latency per call | QPS ceiling | Why |
> |---|---|---|---|
> | local cache | ~100 ns | millions/s | a Map read in the same process, bounded by CPU |
> | single Redis node | ~0.5 ms | ~100,000/s | RAM operation, but over the network |
> | single DB machine | ~1-10 ms | ~5,000-10,000/s | SSD + SQL parsing + B-Tree lookup |
>
> Redis is faster than the DB for more than the 10 times lower latency. Redis is a pure RAM HashMap lookup, no SQL parsing, no disk IO. It also leaves the DB less to do: out of 100,000 requests, Redis answers 90,000 and the DB handles only 10,000.

---

> **"During resharding (4 machines to 8), can live redirect requests still be served normally?"**
>
> Yes. The short_key does not change, the data does not change, it only moves. What changes is the N in `% N`:
>
> ```text
> key = "Xk9mP2q"
> old: hash("Xk9mP2q") % 4 = 2 → data is in shard_2
> new: hash("Xk9mP2q") % 8 = 6 → should move to shard_6
> ```
>
> During migration, query both. Short URLs are immutable, so old and new always agree:
>
> ```text
> request "Xk9mP2q" arrives
>   → new hash: % 8 = 6 → query shard_6
>     not moved yet → nothing
>   → old hash: % 4 = 2 → query shard_2
>     found → return
>
> after the background move finishes:
>   → new hash: % 8 = 6 → query shard_6 → found → return (no need to query the old one)
> ```
>
> Once everything has moved, turn off the "query the old shard" logic. If the data could change (mutable), double querying gets messy: the old and new shards might hold different values, and there is no way to know which one is right. But short URLs do not change, so double querying is fine.

---

> **"URL mappings are immutable, but a user wants to change the long_url (point it at a new target). How does the cache handle it?"**
>
> Now the mapping is no longer immutable. The DB changed, but Redis and the local cache still hold the old value, so cache invalidation is needed.
>
> The approach: update the DB first (the source of truth), then delete that entry from the Redis cache, so the next read reloads it from the DB.
>
> ```text
> 1. UPDATE DB:   "Xk9mP2q" → "https://example.com/new-page"
> 2. DEL Redis:   delete "Xk9mP2q" (so the next read misses and reloads)
> 3. next request → cache miss → fetch the latest value from the DB → write to cache
> ```
>
> Delete rather than update, because delete is idempotent (deleting twice makes no difference). Update has a race condition: two people change it at the same time, and which one writes the cache last is uncertain.
>
> It cannot go the other way, cache first then DB: if the cache update succeeds but the DB fails, the cache rebuilt from the DB after a restart goes back to the old value. The DB is the source of truth, so always update the DB first.
>
> Local cache: set a short TTL (say 30 seconds) and let it expire on its own, or publish an event when the DB changes so every server clears that entry.

---

> **"Store more than the URL mapping. Add each short URL's creator, click count, and last click time. How does the schema change? How does the read/write pattern change?"**
>
> It used to be read-heavy: created once (write), redirected countless times (read), a read:write ratio of 100:1. With click_count and last_clicked_at added, every redirect has to update, and read-heavy becomes read-write mixed.
>
> If every redirect wrote to the DB directly, the DB could not handle it, because 6,000 QPS of reads becomes 6,000 QPS of writes, and writes cost far more than reads. So split "respond right now" from "record the data":
>
> ```text
> click_count: Redis INCR (atomic, O(1))
>   every redirect: INCR click_count:Xk9mP2q
>   dashboard query: GET click_count:Xk9mP2q → 12,847
>   synced to the DB on a schedule for persistence
>
> last_clicked_at + detailed analytics: into Kafka
>   the redirect publishes a click event → Kafka → consumer writes to the analytics DB (ClickHouse)
>   the redirect path never touches the DB
> ```
>
> The redirect does only two extra operations at millisecond scale (Redis INCR + Kafka append) and does not touch the DB. Details in the [next article](article://url-shortener-read).

---

## What if there is no X

---

> **"No Redis allowed. How does a read-heavy DB cope?"**
>
> Two layers as replacements:
>
> 1. **Read replica**: the DB's leader-follower replication, with reads sent to followers. Add 3 read replicas and reads spread across 3 followers. Short URL mappings never change, so replication lag does not affect correctness.
> 2. **Local cache (in-process LRU)**: a Map in the application's memory answers hot keys first, with no network.
>
> ```text
> with Redis:     request → local cache → Redis → DB
> without Redis:  request → local cache → read replica
> ```
>
> Not as economical as a shared Redis cache. Each server has its own local cache, so the same key is queried from the DB once per server before it is cached. But the two layers together handle most scenarios.

---

> **"No consistent hashing library allowed. How do you assign shards?"**
>
> The simplest `hash % N`, one line:
>
> ```text
> shard = hash("Xk9mP2q") % 4 = 2 → shard_2
> ```
>
> The downside: adding a machine changes N and most keys have to move. But short URLs are immutable data, so the move has no write conflicts to handle, and double querying (new shard first, then the old shard on a miss) completes the migration while live.

---

> **"No managed DB (RDS, Cloud SQL); you run it yourself. How do you do backup and failover?"**
>
> Running it yourself means everything the managed DB did is now your job.
>
> **Backup**:
>
> ```text
> PostgreSQL:
>   pg_basebackup — full backup
>   WAL archiving — continuously ship WAL files to S3
>   the two combined → Point-in-Time Recovery (restore to any moment)
>
> MySQL:
>   mysqldump — logical backup (slow but universal)
>   xtrabackup — physical backup (fast, no table locks)
> ```
>
> **Failover**:
>
> ```text
> PostgreSQL:
>   Patroni — manages leader-follower automatically; promotes on leader failure
>   manual: pg_promote() promotes a follower to leader
>
> MySQL:
>   MHA (Master High Availability) — automatic failover
>   manual: STOP REPLICA → RESET REPLICA ALL → becomes the new leader
> ```
>
> RDS's "Multi-AZ" is automatic failover, and "Automated Backups" is a daily snapshot plus the transaction log (PostgreSQL's WAL, MySQL's binlog).

---

## How 100,000 redirects per second flow

How the read path handles 100,000 redirects per second, and where click analytics live, is in the [next article](article://url-shortener-read).
