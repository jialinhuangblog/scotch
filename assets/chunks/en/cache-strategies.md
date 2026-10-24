---
title: "Cache Strategies"
slug: cache-strategies
brief: "Cache-aside, write-through, write-behind. Each has a stale window."
date: 2026-03-31
updated: 2026-10-17
revisions: 3
article: cap-cache-acid
---

# Cache Strategies

> Once a system has a cache, does a read check the cache or the DB first? On a write, which side is updated first?

## Read strategies

### Cache-Aside

The application manages the cache itself. A read checks the cache first; on a miss it queries the DB, then writes the result back to the cache.

```text
1. GET cache("user:42")  → miss
2. SELECT * FROM users WHERE id=42  → found
3. SET cache("user:42", data, TTL=30min)
4. return data
```

The next read of "user:42" comes straight from the cache without touching the DB.

This is the most common pattern. The standard Redis + MySQL combination almost always uses cache-aside.

**Problem**: after a DB update the cache is still old, until the TTL expires or someone deletes it by hand. Reads during that window return stale data.

### Read-Through

The idea is "the cache layer queries the DB itself, and the application talks only to the cache". But this pattern requires the cache system itself to **be able to connect to the DB and know how to query it**.

**Plain Redis cannot do read-through**. Redis is a key-value store. It has no callback mechanism for "fetch from the DB on a miss".

Three situations where real read-through exists:

**1. An in-process cache with a loader** (Caffeine / Guava)

```java
LoadingCache<Long, User> cache = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(30, MINUTES)
    .build(userId -> userRepository.findById(userId));  // ← loader

User u = cache.get(42L);  // on a miss the library calls the loader automatically
```

Once the loader function is registered with the library, the library calls it automatically on a miss. From the application code's point of view this is read-through, but the loader that queries the DB is still written by the application.

**2. A managed cache bound to a specific DB** (AWS DAX)

DAX is a cache layer built only for DynamoDB. On a miss it goes back to DynamoDB for the data on its own. The app calls only DAX and never touches DynamoDB. This is native read-through.

**3. CDN**

When a CDN node misses, it fetches the content from the origin on its own. The application does not need to know.

### Redis + MySQL is almost always cache-aside

Redis has no loader mechanism, so all the logic after a cache miss lives in application code. Some people loosely call this pattern read-through. Strictly, it is cache-aside.

## Write strategies

### Write-Through

A write updates the cache and the DB together. It counts as successful only when both are written.

```text
1. update cache("user:42", newData)
2. UPDATE users SET ... WHERE id=42
3. both succeed → return OK
```

**Benefit**: the cache is always current, no stale data.
**Price**: every write adds one more cache operation, so latency goes up. And if nobody ever reads this record, writing it to the cache is wasted.

### Write-Behind (Write-Back)

A write updates only the cache, without writing the DB right away. After the cache collects a batch, a background process writes it to the DB asynchronously.

```text
1. update cache("user:42", newData) → return OK right away
2. (background) once enough has collected, or enough time has passed → batch write to DB
```

**Benefit**: very low write latency, and batch writes reduce DB pressure.
**Price**: if the cache goes down, data not yet written to the DB is lost. Only suited to cases that can tolerate losing a little data (view counts, like counts).

### Write-Around

A write updates only the DB and leaves the cache alone. The next read that misses loads it from the DB.

```text
1. UPDATE users SET ... WHERE id=42 → return OK
2. the old data in the cache disappears on its own when the TTL expires
```

Suited to data written often and read rarely. Freshly written data is not necessarily read right away, so there is no need to take up cache space.

## How the five split

### Who handles the miss and the write back to the DB

```text
the cache connects to the DB itself, the app talks only to the cache    Read-Through, Write-Through, Write-Behind
the app connects to the DB itself, the cache is just key-value          Cache-Aside, Write-Around
```

In the ones with "through" in the name, the request passes through the cache to the DB, and the cache holds the DB connection. Write-Behind has no "through" in its name but belongs to the same group, because the schedule for writing back to the DB lives in the cache. In the other group the cache is a passive key-value store. Querying the DB, filling the cache and deleting keys are all written in the app's code. Redis is this kind.

### When the write reaches the DB

```text
sync     Write-Through   return OK only after both cache and DB are written
async    Write-Behind    return OK after the cache is written, batch to DB later
skip     Write-Around    write the DB directly, the cache refills on the next miss
```

A Cache-Aside write is usually "write the DB, then delete the cache key", which is Write-Around plus one delete, so the old value does not have to wait for the TTL.

### Why Read-Through usually pairs with Write-Through

Both need the cache to connect to the DB itself. Once that layer exists (DAX, Hibernate second-level cache), reads and writes both go through it. The other way round, Cache-Aside pairs with write DB then delete key, since the app handles both sides. Redis + MySQL almost always looks like this. Write-Behind mostly stands alone, for counters and similar data with many writes where losing a few does not matter.

## How to choose

| Scenario | Strategy | Reason |
|---|---|---|
| General CRUD | Cache-aside + write-around | simple; data read often and written rarely enters the cache on its own |
| Very heavy reads, strict consistency | Read-through + write-through | the cache is always current |
| Very heavy writes, data loss tolerated | Write-behind | like counts, view counts |

Cache-aside is enough for most systems.

---

What happens when the cache has no answer and requests fall through to the DB (avalanche, penetration, stampede) is in [Cache Stampede](chunk://cache-stampede).

