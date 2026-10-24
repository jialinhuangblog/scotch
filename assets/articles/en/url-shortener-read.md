---
title: "A short link jumps away the instant you click it. How does that click get recorded?"
slug: url-shortener-read
subtitle: "The redirect has to be fast, and analytics has to record every click, but recording it synchronously slows the redirect down."
chapter: "url-shortener"
tags: [url-shortener, rate-limiter, cdn, analytics, idempotency, fan-out]
date: 2026-03-21
updated: 2026-10-17
revisions: 1
related: [url-shortener-key, url-shortener-store, url-shortener-demo]
---

# A short link jumps away the instant you click it. How does that click get recorded?

The [first](article://url-shortener-key) and [second](article://url-shortener-store) articles covered how the key is generated and how the data is stored. What happens after a user clicks the short link?

```text
Article one:   long_url → short_key (how to generate it)
Article two:   short_key → DB/cache (how to store it)
Article three: user clicks the short link → where the traffic goes
```

A short link service does one thing: redirect. Someone posts a short link on a social platform and 100,000 people click it at the same time. Every click is an HTTP request, and the server has to return a 302 within tens of milliseconds. Meanwhile the product manager wants a dashboard: how many clicks did this link get today? From which countries? When was the peak?

Recording the click is extra work. Done synchronously it slows the redirect down, and the redirect is the one thing that cannot be slow.

---

## Read Path

One redirect request from start to finish:

```text
user clicks short.url/Xk9mP2q
  → DNS lookup
  → Load Balancer
  → Application Server
    → check Redis cache
      ├─ hit  → return 302 + long_url
      └─ miss → query DB → write cache → return 302
```

The slowest step in the whole path is the DB query on a cache miss. The previous article already covered cache and sharding. Under the previous article's 80/20 assumption, the cache hit rate is normally above 80%, and most redirects finish in a few milliseconds.

### If the URL does not exist

The short_key is not found, so return 404. But before returning 404, the cache and the DB both have to be checked to confirm it really does not exist.

If someone deliberately sends a flood of short_keys that do not exist, every one misses the cache and every one queries the DB. This is cache penetration.

The fix is a Bloom filter. Put every existing short_key into the Bloom filter and check it first when a request arrives. "Definitely does not exist" returns 404 directly, with no cache lookup and no DB lookup.

```text
short_key = "fakeKey"
  → Bloom filter: definitely does not exist → 404 (skips the cache + DB lookup)

short_key = "Xk9mP2q"
  → Bloom filter: might exist → go on to the cache → ...
```

---

## Write Path

The API for creating a short link:

```text
POST /api/shorten
{
  "long_url": "https://example.com/very/long/path",
  "custom_alias": "my-brand",    // optional
  "expires_in": "30d"            // optional
}
```

### Rate Limiting

The write API has to cap how many links each user can create, or someone can create short links without limit.

```text
Rate limiter:
  anonymous user: 10 per hour
  logged-in user: 1000 per hour
  paid user:      10000 per hour
```

Which layer does the rate limiter go in?

```text
Option A: API Gateway layer (blocks earliest, saves application server resources)
Option B: Application layer (can apply different limits per user tier)
Option C: both layers (Gateway handles DDoS, Application handles per-user abuse)
```

### Idempotency

The same request sent twice (a network retry) should not create two different short links.

```text
first time:  POST /api/shorten + Idempotency-Key: abc-123
  → create short_key = "Xk9mP2q", store {abc-123: "Xk9mP2q"}
  → return 201

second time: POST /api/shorten + Idempotency-Key: abc-123
  → find abc-123 already processed
  → return 201 + short_key = "Xk9mP2q" (no new one created)
```

The idempotency key lives in Redis with a 24 hour TTL. Anything older than 24 hours is unlikely to be a retry. It is a new request.

---

## Analytics

What the product manager needs:

1. Total clicks per short link
2. Click trend per day and per hour
3. Country, device and browser of each click
4. A real-time dashboard

### The problem: the redirect path cannot get slower

If every redirect writes one click record to the DB synchronously, redirect latency goes from 5ms to 50ms, and at 100,000 QPS the DB cannot keep up either.

### The fix: process asynchronously

The redirect does not write to the DB. It drops the click event into a message queue and returns 302 right away.

```text
user clicks short.url/Xk9mP2q
  → check cache → get long_url
  → send click event to Kafka
     {short_key, timestamp, ip, user_agent, referer}
  → return 302 + long_url

Kafka consumer (a separate group of workers):
  → consume click event
  → resolve IP → country
  → parse User-Agent → device, browser
  → write to analytics DB (ClickHouse / TimescaleDB)
```

The redirect path never touches the analytics DB. Dropping a click event into Kafka takes milliseconds (append-only log).

### 301 vs 302, one more look

```text
301: the browser caches the redirect; later clicks never reach the server
302: every click goes through the server
```

With 301, only the first click produces a click event. Later clicks jump straight from the browser, the server never sees them, and analytics undercounts badly.

With 302, every click goes through the server, so every one can be recorded.

If analytics is not needed, 301 saves a lot of server load. If analytics is needed, 302 is the only option. Most short link services pick 302.

### Fast lookup of the click count

The analytics consumer aggregates click events and writes them into the analytics DB. But the product manager wants the click count in real time.

Use Redis INCR:

```text
on every redirect:
  INCR click_count:Xk9mP2q
  (atomic, O(1), never touches the analytics DB)

dashboard query:
  GET click_count:Xk9mP2q
  → 12,847
```

Redis INCR is atomic, so the count stays correct under high concurrency. But when Redis restarts, any count not yet persisted is lost, so the Redis count has to be synced to the analytics DB on a schedule.

---

## Hot URL

One short link suddenly goes viral. 100,000 people click in the same second.

### The problem at the cache layer

If that URL happens to miss the cache (TTL expired or Redis restarted), 100,000 requests hit the DB at once.

The fix is **Singleflight / request coalescing**. Out of 100,000 requests, only the first queries the DB. The rest wait for its result.

```text
request 1        → cache miss → query DB → get result → write cache → return
request 2~100000 → cache miss → see someone is already querying → wait → get request 1's result → return
```

### The CDN layer

If one short link draws more traffic than the application servers can handle, a CDN can take it.

```text
user → CDN edge (around the world) → origin server
```

Can a CDN cache a 302 response? 302 is a temporary redirect, and without an explicit cache directive a CDN usually does not store it. But if the response carries `Cache-Control: public, max-age=300`, the CDN caches it for 5 minutes. For those 5 minutes every redirect for that short link is answered by the CDN and never reaches the origin.

The cost: click events during those 5 minutes are not recorded (they never pass through the origin server). Analytics accuracy goes down as CDN cache time goes up.

---

## Fan-out: notifying the link owner

An advanced feature: the link owner wants an instant notification, "someone clicked this link".

```text
few followers (personal user, a handful of links):
  → Fan-out on write: push a notification on every click

many followers (enterprise user, thousands of links):
  → Fan-out on read: pull the latest numbers when the dashboard opens
```

A personal user's links get few clicks, so pushing a notification each time is fine. An enterprise user's links may get thousands of clicks per second, and pushing on every one would overwhelm the notification service.

---

## Interviewer follow-ups

---

> **"The Kafka consumer dies and click events pile up in Kafka. Does the redirect suffer?"**
>
> No. The app server drops the click event into Kafka and returns 302 right away, without waiting for Kafka to confirm. Whether or not a consumer is reading has no effect on the redirect server returning 302.
>
> Kafka keeps messages for 7 days by default. Past that, data starts to drop:
>
> ```text
> consumer down for 6 hours:
>   → 6 hours of click events pile up in the partition
>   → after recovery it resumes from its offset and catches up on all of them
>   → dashboard fills in, zero data loss
>
> consumer down for 8 days:
>   → events older than 7 days are deleted by Kafka (retention expired)
>   → that stretch of data is gone for good, analytics has a gap
> ```
>
> Monitoring: track the consumer group lag (how far the current offset is from the latest offset). A sudden jump in lag means the consumer cannot keep up or has died. The alert has to fire before retention expires.

---

> **"The Redis INCR click count and the analytics DB count disagree. Which is the source of truth?"**
>
> Neither is a source of truth on its own. Redis holds the increment since the last flush, not the total. ClickHouse holds the historical total, without the latest increment. The total is the two added together:
>
> ```text
> ClickHouse total_clicks: 12,000 (historical total)
> Redis INCR:              847    (added since the last flush)
>
> total = 12,000 + 847 = 12,847
>
> after the flush:
>   ClickHouse total_clicks → 12,847
>   Redis INCR → 0 (reset, starts accumulating again)
> ```
>
> Every click event flows through Kafka, and both stores are views derived from Kafka. Within 7 days, if the two numbers added together do not match the Kafka event count, a Kafka replay is the reference. Past 7 days the events have been deleted by retention, and there is nothing in Kafka to check against.
>
> In practice nobody replays Kafka to reconcile a click count. Click counts are best-effort, and a small error is acceptable.

---

> **"The same person clicks the same short link repeatedly. Should the click count dedup?"**
>
> Total clicks and unique visitors are two different metrics, counted separately.
>
> "The same person" is identified by IP or session ID (cookie). Neither is precise: in an office, hundreds of people share one IP, and in incognito mode every session is new. But unique visitors never needed to be exact to the last digit. Good enough.
>
> **Bloom filter**: answers "has this session clicked before" (yes/no), used to rule out duplicates:
>
> ```text
> click arrives
>   → Bloom filter: has session_abc been seen
>     ├─ not seen → INCR unique_count, add session_abc to the filter
>     └─ seen     → no INCR, this one does not count
> ```
>
> **HyperLogLog**: answers "how many unique sessions in total" (a number), used for counting:
>
> ```text
> PFADD unique:Xk9mP2q "session_abc"   → added
> PFADD unique:Xk9mP2q "session_abc"   → already there, no change
> PFCOUNT unique:Xk9mP2q              → about 9,200 (error 0.81%)
> ```
>
> HyperLogLog does not store each session ID. It only updates a fixed-size set of internal counters (12KB). One million unique visitors is still 12KB; it does not grow with cardinality. Storing session IDs in a plain Redis Set takes tens of MB per million, and multiplied across every URL the memory runs out.

---

> **"Analytics data keeps growing (hundreds of millions of click events per day). How do you control cost?"**
>
> Squash raw events older than 7 days into a daily summary, then delete the raw events. The summary is kept forever, and its size is predictable.
>
> Daily summary schema:
>
> ```text
> short_key | date       | country | device  | total_clicks
> Xk9mP2q  | 2026-03-28 | TW      | mobile  | 1,234
> Xk9mP2q  | 2026-03-28 | TW      | desktop | 567
> Xk9mP2q  | 2026-03-28 | US      | mobile  | 890
> ```
>
> One row per (short_key, date, country, device) combination. The date is the time range by itself, so no extra timestamp range is stored.
>
> Keeping 7 days rather than 1 day lines up with Kafka retention. If a consumer bug (bad data written) is found within those 7 days, the events can be replayed from Kafka and reprocessed. Past 7 days Kafka has deleted them too, so the raw events cannot be repaired anyway, and squashing them loses nothing.
>
> Dashboard queries: within 7 days go to raw events (any dimension), older ones go to the daily summary. A user querying the dashboard never needs to know which table the data came from.

---

> **"If you use 301 instead of 302 (letting the browser cache), but still want analytics, is there a way to have both?"**
>
> From the URL shortener's own side: no.
>
> Once the browser caches the 301, later clicks jump straight to the destination and never pass through the server. The server does not receive those requests, so analytics cannot record those clicks.
>
> One idea is injecting a tracking script into the landing page, so after the jump the JS sends an analytics beacon back. But the landing page is someone else's site. The URL shortener has no control over it and cannot inject anything.
>
> Another route is an interstitial page: the 301 first jumps to a page you control, which records the click and then redirects to the long_url. It records, but the user sees the screen flash, which is a bad experience, and ordinary short link services do not do this by default just for analytics. Services with an interstitial have other reasons: adf.ly puts ads on it and shares revenue with the link author, and TinyURL's preview shows the destination so the user can decide whether to click.
>
> If analytics is needed, 302 is the only way.
>
> ---
>
> The end user (a marketer with GA on the destination page) is unaffected. GA fires after the landing page loads, and it records the visit whether it arrived through a 301 or a 302. These are two different analytics needs.

---

> **"The whole analytics pipeline is down (Kafka and the consumer both dead). Should the redirect keep serving or degrade?"**
>
> The redirect keeps going. Analytics is an add-on; the redirect is the core product. With analytics down, a user who clicks a link still has to reach the destination. A redirect outage is the serious one: the user clicks and goes nowhere, and at that point nobody cares whether analytics is broken.
>
> The approach is fire-and-forget: the app server drops the click event into Kafka, does not wait for an ack, and returns 302. If Kafka is down, at worst a few click events are lost. The redirect is untouched.

---

## What if you cannot use X

---

> **"No Kafka. How do you do click analytics?"**
>
> Use a Redis List as the queue. Every redirect does an `RPUSH` of the click event, and a worker pulls them out in batches on a schedule and writes them to the analytics DB:
>
> ```text
> redirect → RPUSH click_queue {event}   (push at the tail, so LRANGE 0 999 returns the oldest batch)
>
> worker every 30 seconds:
>   LRANGE click_queue 0 999   → take 1000 entries
>   bulk insert → analytics DB
>   LTRIM click_queue 1000 -1  → remove the processed ones
> ```
>
> The difference from Kafka: when a Kafka consumer dies, the offset stays put and it resumes where it left off after recovery. A Redis LTRIM is final. If the worker dies before the bulk insert, that batch of events is lost. Click counts are best-effort, and this risk is usually acceptable.

---

> **"No CDN. How do you handle a hot URL?"**
>
> The Redis cache is already there, but a hot URL becomes a Redis hot key. Tens of thousands of requests read the same key at once, and the shard holding that key cannot keep up.
>
> Add an in-process local cache on each app server, above Redis:
>
> ```text
> redirect arrives
>   → check local cache (in-memory, nanoseconds)
>     ├─ hit  → return 302 (Redis never touched)
>     └─ miss → check Redis → write local cache → return 302
> ```
>
> A short_key → long_url mapping never changes after creation, so the local cache value is never wrong and needs no invalidation. The one thing to handle is expiry (`expires_in`): give the local cache a short TTL, or store expires_at with the entry and check it on read. The hot URL has a copy on every server, and the Redis hot key problem disappears.

---

> **"No Redis INCR. How do you do a real-time click count?"**
>
> Each app server keeps an atomic counter in process memory and flushes it to the DB on a schedule:
>
> ```text
> on every redirect:
>   counter["Xk9mP2q"] += 1 (atomic, thread-safe)
>
> every 30 seconds:
>   UPDATE url_stats SET total_clicks = total_clicks + {delta}
>   counter["Xk9mP2q"] = 0
> ```
>
> Each server flushes on its own, the DB accumulates with `+= delta`, and the sum is the total. No coordination between servers is needed. A server restart loses at most 30 seconds of counts, and click counts are best-effort, so that is acceptable.

---

## The whole system

The components from all three articles in one picture:

```text
                                    ┌─────────────┐
                                    │   CDN Edge   │
                                    └──────┬───────┘
                                           │
┌────────────┐    POST /shorten     ┌──────┴───────┐    GET /<key>
│   Client   │ ──────────────────→  │     LB       │ ←──────────────
└────────────┘                      └──────┬───────┘
                                           │
                              ┌────────────┴────────────┐
                              │    Application Server    │
                              │  ┌─────────┐ ┌────────┐ │
                              │  │ Rate    │ │ Bloom  │ │
                              │  │ Limiter │ │ Filter │ │
                              │  └─────────┘ └────────┘ │
                              └────┬─────────────┬──────┘
                                   │             │
                            ┌──────┴──┐    ┌─────┴──────┐
                            │  Redis  │    │   Kafka    │
                            │  Cache  │    │ click event│
                            └────┬────┘    └─────┬──────┘
                                 │               │
                            ┌────┴────┐    ┌─────┴──────┐
                            │ DB Shard│    │ Analytics  │
                            │ 0,1,2,3 │    │ Consumer   │
                            └─────────┘    └─────┬──────┘
                                                 │
                                           ┌─────┴──────┐
                                           │ ClickHouse │
                                           │ Analytics  │
                                           └────────────┘
```

| Component | Matching chunk |
|---|---|
| Short key generation | unique-id, bloom-filter |
| Cache | cache-strategies, cache-eviction |
| DB sharding | sharding, consistent-hashing |
| Rate limiting | rate-limiter |
| Idempotency | idempotency |
| Analytics pipeline | fan-out |
| CDN | cdn-caching |
| Real-time push | websocket |
