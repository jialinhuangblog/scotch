---
title: "As traffic grows, which layer comes first: CDN, cache or queue?"
slug: scaling-first-move
subtitle: "You know every part. What you do not know is which one to touch first, and why."
chapter: "scaling"
tags: [cache-strategies, cqrs, cap, sharding, reverse-proxy, api-gateway, cdn]
date: 2026-04-07
updated: 2026-10-17
revisions: 1
related: [cache-hot-key, queue-peak-shaving, rate-limiter, storage-deep, replication-cap]
---

# As traffic grows, which layer comes first: CDN, cache or queue?

The system has to handle one million requests per second.

CDN, Load Balancer, Cache, Sharding, CQRS, Message Queue. You recognize every part and can explain each one. But you cannot draw the road a request takes from entry to the DB and back, and you cannot say what to add first and what to add later.

---

## The road one request takes

One request, from the user's browser to the DB and back:

```text
user → CDN → Load Balancer → API Gateway → App Server → Cache → DB
```

This line is also the order of decisions.

Traffic enters from the left, so handle it from the left. Only when the layer on the left is no longer enough do you add the next layer to the right. You do not put everything in from the start.

The [CDN](chunk://cdn-caching) answers requests for static assets directly. With an 80% hit rate, 800,000 of the 1 million requests never reach a server.

The [Load Balancer](chunk://l4-vs-l7-lb) spreads the remaining 200,000 across several App Servers. L4 is fast and only looks at IP + port. L7 is a little slower, but it can see the URL path and headers and route more precisely. Most scenarios use L7.

The [API Gateway](chunk://api-gateway) handles authentication, rate limiting and request transforms. The LB only distributes traffic. The Gateway looks at the content to authenticate and rate limit.

Only after the App Server does application code start running.

---

## Look at the read path and the write path separately

Most systems read far more than they write. The read path and the write path have different bottlenecks and different fixes.

### The decision chain on the Read Path

The goal of the read path is to touch the DB as little as possible.

**Step one: add a cache.** The most obvious choice is [Cache-Aside](chunk://cache-strategies). The application manages the cache itself. Check Redis first, query the DB on a miss, and write the result back to Redis. Simple to build, predictable behavior, and enough for most systems.

**Step two: the cache stops answering and requests go straight to the DB.** Adding capacity does not fix this. The problem is how entries expire or go missing.

| Situation | Cause | Fix |
|---|---|---|
| Avalanche | many keys expire at the same time | add a random value to the TTL |
| Penetration | the key does not exist at all | [Bloom filter](chunk://bloom-filter) |
| Stampede | a hot key expires | Mutex + singleflight |

In all three the cache does not answer the request and everything goes to the DB. Details in [When do requests bypass the cache and query the DB directly?](article://cache-hot-key).

**Step three: the DB itself cannot keep up.** Add read replicas. One master writes, several followers read. Read traffic spreads out linearly. The cost: replication lag, a follower may be a few milliseconds behind. See [With data copied to several machines, do reads get new or old data?](article://replication-cap).

**Step four: read replicas are not enough either.** [Sharding](chunk://sharding). Split the data into pieces, each on a different machine. Both reads and writes spread out. The cost: cross-shard queries are hard to handle, and resharding is even more trouble. See [Data grows, queries slow: what index, partition, sharding each do](article://storage-deep).

### The decision chain on the Write Path

The read path has one clear default answer: Cache-Aside. The write path has none.

Three options, each giving up one of latency, durability, or the first read hit:

**[Write-Through](chunk://cache-strategies)**: write to the cache and the DB, and return only when both succeed.

```text
user writes → update cache → update DB → both succeed → OK
```

Highest consistency. But every write is two operations, so the latency is the highest too.

**[Write-Behind](chunk://cache-strategies)**: write only to the cache, and write to the DB asynchronously in batches in the background.

```text
user writes → update cache → OK right away
(background) accumulate a batch → batch write to DB
```

Lowest latency. But if the cache goes down, the data not yet written to the DB is lost.

**Write-Around**: write only to the DB and leave the cache alone. Load it on the next read miss.

```text
user writes → update DB → OK
(next read) cache miss → load from DB → write back to cache
```

The simplest. But the first read of freshly written data is always a cache miss.

#### How to choose

**Question one: does losing the data cause harm?**

Yes (user balance, orders) → Write-Through. Synchronous writes, both sides consistent. Slow, but safe.

No (like counts, view counts) → Write-Behind. Fast, and nobody notices if a few records are lost now and then.

**Question two: will someone read it right after the write?**

Yes (change your name and see it at once) → Write-Through or Write-Behind. The cache is always current.

No (logs, analytics, archives) → Write-Around. Writing it into the cache would only waste space.

```text
                   Does losing the data cause harm?
                    /           \
                  yes             no
                  |               |
            Write-Through    Write-Behind
                  |
            Read right after the write?
            /         \
          no            yes
          |             |
    Write-Around   (stay with Write-Through)
```

---

## When to split into CQRS

Thinking about the read path and the write path separately is a way of thinking. [CQRS](chunk://cqrs) turns that way of thinking into architecture: the read model and the write model use different schemas, even different DBs.

Most systems do not need CQRS. Three signals for introducing it:

**Signal one: the read model and the write model look nothing alike.** Writes store normalized orders + order_items + products. The dashboard wants "this month's sales ranking by product category". Every read JOINs three tables and then GROUP BYs. If the ranking is precomputed and stored in another table, a read is one SELECT.

**Signal two: read and write scale are far apart.** 100 writes per second, 100,000 reads per second. On a shared table, write locks slow the reads down. Separated, each scales on its own.

**Signal three: an event-driven architecture already exists.** The write side publishes events, the read side consumes them to update its own model. With a [message queue](chunk://message-queue-comparison) already in place, CQRS is just one more consumer updating the read model.

### When would you regret it

The cost of CQRS is maintaining two schemas. Every change to the write model raises the question of whether the read model follows. If the read and write models are actually about the same, CQRS only creates synchronization problems.

The read model is updated asynchronously, and that is a cost too. After a user writes, the read model may not be updated yet. During that window the user sees old data. If that is not acceptable, CQRS may not fit.

---

## CAP: from the triangle to the actual choice

[CAP](chunk://cap) is often drawn as a triangle: Consistency, Availability, Partition Tolerance, pick two of three. But partitions always happen, so the only real choice is C or A when the network splits.

So the question "is your system CP or AP" is itself wrong. CP or AP is chosen per piece of data and per operation, not once for the whole system.

| Data | Choice | Why |
|---|---|---|
| User balance | CP | better briefly unavailable than deducting the wrong amount |
| Like count | AP | showing 999 or 1001 for a moment, nobody cares |
| Stock deduction | CP | overselling is a real loss |
| Stock display | AP | showing "3 left" when there are really 5 is a small problem |
| Session | AP | logging in again now and then beats not being able to log in at all |

Within one system, different data uses different strategies. Even the read and the write of the same data can use different strategies: stock deduction picks CP, stock display picks AP.

### How CAP connects to the cache strategy

Look back at the read and write path choices above:

- Cache-Aside + read replica = leans AP. Both the cache and the replica may hold stale data, but availability is high.
- Write-Through + synchronous replication = leans CP. Every write waits for both sides to confirm. Consistent but slow.

---

## What the cloud already handles

On AWS some layers are already handled, and the rest you still decide yourself:

| Concept | What AWS handles | What you still decide |
|---|---|---|
| [CDN](chunk://cdn-caching) | CloudFront: global edge nodes, GZIP, HTTP/2 | Cache Behavior, TTL, invalidation rules |
| [Load Balancer](chunk://l4-vs-l7-lb) | ALB / NLB: health checks, auto-scaling integration | Target group, routing rules |
| [Cache](chunk://cache-strategies) | ElastiCache Redis: automatic backup, failover | cache strategy, key design, TTL |
| [DB](chunk://aurora) | Aurora: automatic backup, failover, read replicas, storage auto-scaling | Connection pool settings, index, query optimization |
| [Sharding](chunk://sharding) | DynamoDB: automatic partitioning, automatic capacity adjustment | Partition key design (wrong choice = hot partition) |

---

## Where the effort goes

```text
90%  Application Layer
      ├── cache strategy choice (Cache-Aside? Write-Behind?)
      ├── read/write path design
      ├── whether to split into CQRS
      ├── key design (Redis key, partition key)
      └── query optimization (index, N+1)

 9%  Configuration
      ├── connection pool size
      ├── TTL settings
      ├── number of replicas
      └── rate limit thresholds

 1%  Infrastructure
      └── handled by managed services
```

---

## The assembly order

Back to the opening question. One million requests come in. Which part do you touch first?

```text
1. Draw the line   CDN → LB → Gateway → App → Cache → DB
2. Split           read path and write path, separately
3. Read            start with Cache-Aside; when misses pile up, treat the specific cause
4. Write           ask two questions: can you afford to lose it? is it read right after the write?
5. Still not enough  replica → sharding → CQRS (most systems never get this far)
6. CAP             not chosen for the whole system, chosen per piece of data and per operation
```
