---
title: "We set up a cache, and it almost never got used"
slug: search-cache
subtitle: "From a naive cache to production, the difference is three moves: normalize, canonical path, multi-tier."
chapter: "search"
tags: [cache, search, redis]
date: 2026-04-28
updated: 2026-10-17
revisions: 1
related: [search-geo, cache-hot-key, wishlist-dataloader]
---

# We set up a cache, and it almost never got used

The [previous article](article://search-geo) built the main search architecture: Postgres + ES + CDC. Once the system grows, the next question is whether a popular query has to hit ES every single time.

The first reaction is usually "of course, cache it".

But hash 5 dimensions into a Redis key with a 60 second TTL, and that key almost never shows up twice. **The hit rate is very low** (in the decision scenario below, one week after launch it was 8%).

---

## Why a search cache is not that simple

All of these systems have to answer the same question: **how do you design the cache key**.

| System | The same cache key question |
|---|---|
| Twitter feed | how fine should the timeline cache be? |
| YouTube | how is the video metadata cache key built? |
| URL shortener | what is the cache strategy for hot URLs? |
| Uber matching | how is the driver location cache partitioned? |
| Airbnb search | search result cache |

---

## Two cache layers: ES built-in vs Application

### Layer 1: ES built-in (automatic, but not much help for popular queries)

ES has 4 caches of its own:

| Cache | What it does | Help for popular queries |
|---|---|---|
| **Query cache (filter cache)** | per node, one LRU shared by every shard on that node, caches filter context results | partial (the filter hits, but the score is recomputed) |
| **Request cache** | per shard, caches the whole response | by default only works for size=0 (pure aggregation) |
| **Field data cache** | field values used by sort / aggregation | indirect (hot fields stay in memory) |
| **OS page cache** | Linux file system, hot segments stay in RAM | large but coarse |

For a popular query like "Tokyo, December", the ES built-in caches hit only partly. The filter part can hit, but score ranking and aggregation results are recomputed. Latency is 5-20ms, not sub-ms.

### Layer 2: Application Redis cache (the main one)

```text
Frontend → Backend
              ↓
       Backend computes the cache key
              ↓
         Redis: is it there?
       ├── hit → return directly (~1ms)
       └── miss → hit ES → get result → write Redis (TTL 60s) → return
```

For a popular query:
- user 1: cache miss, hits ES directly, ~50ms, returns the result and caches it for 60s
- everyone who searches the same query in the next 60 seconds: read from Redis, ~1ms

---

## Why the naive cache key has a low hit rate

The obvious code:

```ts
const cacheKey = hash({ location, dates, guests, filters, sort });
```

A 5-tuple hash. **The hit rate is terrible.** Each dimension has a very different chance of repeating:

| Dimension | Value space | Chance of repeating |
|---|---|---|
| `location` as text (Tokyo) | ~a few thousand cities | high |
| `location` as bbox (map coordinates) | continuous reals, 6 decimal places | **close to 0** |
| `dates` | any date range | medium (popular periods cluster) |
| `guests` | 1-10 | high (discrete) |
| `filters` | boolean combinations | depends on the number of combinations |
| `sort` | 4-5 fixed options | high |

**The bbox is different almost every time.** The user drags the map a little and the whole bbox changes. It can never produce the same key as the previous query.

---

## Fix 1: normalize continuous values

Snap continuous values to a grid, so queries from different users converge on the same cache key.

### Align the dates

```ts
// raw
{ check_in: "2026-12-22", check_out: "2026-12-29" }
{ check_in: "2026-12-23", check_out: "2026-12-30" }
// two different keys, but almost the same travel behavior

// Normalize: align to "Christmas week, December"
{ travel_period: "xmas-2026" }
// now the same key
```

Or coarser: `travel_month: "2026-12"`, the whole month as one bucket.

### Quantize the bbox

```ts
// raw
bbox = [35.659, 139.700, 35.671, 139.734]

// Snap to geohash grid (precision 5, about 5km × 5km per cell)
const cell = geohash(lat, lon, precision: 5)  // "xn76u"
```

Any bbox query whose point falls in this cell shares the cache. The cost is that the cached result covers the whole grid cell and the client has to filter again, but bandwidth is still saved. Details in the [geohash chunk](chunk://geohash).

### Quantize the price

```ts
// raw
{ price_min: 187, price_max: 412 }

// Snap to multiples of 50
{ price_min: 150, price_max: 450 }
```

Some e-commerce and booking sites restrict the UI to preset buckets (a checkbox instead of a slider), so the value is normalized at the source.

### Sort the filters

```ts
// raw (different order → different key)
amenities: ["wifi", "kitchen", "ac"]
amenities: ["ac", "kitchen", "wifi"]

// after sort → same key
amenities: ["ac", "kitchen", "wifi"]
```

---

## Fix 2: split canonical and user-defined into two paths

**Different entry point → different cache strategy**:

| Entry point | bbox source | Cache strategy |
|---|---|---|
| Type a place name in the search bar + Enter | **canonical bbox** (Tokyo is always this bbox) | full cache, high hit rate |
| Arrive by shared URL / bookmark | the bbox inside the URL | full cache |
| Click a recommended city in explore | canonical bbox | full cache |
| **User drags the map / zooms** | the user's current bbox (unique) | **no cache, or geohash bucket** |

### Where the canonical bbox comes from

The backend keeps a table (static / semi-static):

```text
city_id → canonical_bbox + zoom
─────────────────────────────────
Tokyo   → [35.50, 139.40, 35.85, 139.95], zoom 11
Paris   → [48.81, 2.22, 48.91, 2.41],     zoom 12
NYC     → [40.49, -74.26, 40.91, -73.70], zoom 11
```

One row per city, a few thousand rows in total, stored in a Postgres `cities` table or hardcoded.

### The URL design reflects the cache path

A search URL similar to Airbnb's:

```text
# Canonical search (no bbox params, backend applies the canonical bbox)
/s/Tokyo--Japan/homes?adults=2&checkin=2026-12-22&checkout=2026-12-29

# User-defined search (has ne/sw params, backend knows this is a user-defined viewport)
/s/Tokyo--Japan/homes?adults=2&ne_lat=35.71&ne_lng=139.74&sw_lat=35.66&sw_lng=139.70
```

Whether the URL carries bbox parameters decides which cache path the backend takes.

---

## Fix 3: multi-tier cache

Each tier has its own key, and the backend falls back on its own:

```text
L1 (high precision, low hit rate):
  key = hash(full 5-tuple)
  value = full response (20 listings + facets)

L2 (coarse, high hit rate):
  key = hash(city + date week bucket)
  value = list of IDs of all listings in that city for that period
        ↓
        Client filters price / amenities / sort after receiving it

L3 (coarsest):
  key = hash(city)
  value = popular listings in that city (top 200 over the past 7 days)
```

Backend logic:

```ts
const result = await redis.get(L1Key);
if (result) return result;

const ids = await redis.get(L2Key);
if (ids) {
  const listings = await es.mget({ index, ids });
  return clientSideFilter(listings, filters);
}

const popular = await redis.get(L3Key);
if (popular) {
  return clientSideFilter(popular, allFilters);
}

const fresh = await es.search(...);
await redis.setex(L1Key, 60, fresh);
return fresh;
```

**Most production systems use only L1**, because multi-tier logic is complex and has more bugs. L2 / L3 are only worth it when head queries (a small number of queries repeated very many times) make up most of the traffic.

---

## Problems the cache brings with it

### 1. Stampede

The moment a hot cache entry expires, 1000 requests query ES at the same time and ES load spikes.

Fixes:
- **Single-flight**: only 1 request per key is allowed to hit ES at a time; the others wait
- **Stale-while-revalidate**: return the stale result + refresh asynchronously in the background
- **TTL jitter**: add a random ±10% to the cache TTL, so a large batch does not expire together

Details in [The cache is fine, until everyone asks for the same key in the same second](article://cache-hot-key).

### 2. Cache poisoning / malicious flooding

A malicious user sends a flood of unique queries to fill the cache and push out the keys that are actually in use.

Fixes:
- **Admission policy**: before caching, check whether the query is "worth caching" (cache only after it has appeared more than N times)
- **[Rate limit](chunk://rate-limiter) per IP**
- **TinyLFU eviction** (LRU plus a frequency estimate)

### 3. Cache invalidation

```text
host changes the listing price → Postgres updates → CDC syncs to ES
  ↓
the listing in ES is new
  ↓
but the Redis cache is still old!
  ↓
the user sees the old price, clicks in, and finds it does not match
```

Three fixes:
1. **Short TTL (60s)**: accept that data may be stale for up to 60s. Simple but imperfect
2. **Event-driven invalidation**: when a listing updates, the backend clears the related cache entries (needs a tag-based cache)
3. **Cache no listing detail, only IDs + facets**: on a hit, fetch the details from ES in a batch (trade latency for freshness)

Production usually mixes 1 + 2. Add a cache invalidator consumer on the [CDC](chunk://cdc) path, and the moment a listing changes, the related cache entries are cleared.

### 4. Personalized queries cannot be cached

A logged-in user's ranking depends on personal history, so **every user gets different results**.
Fix: anonymous users take the cache path, logged-in users query ES directly (or only cache small pieces of data that belong to that user).

---

## The evolution from naive to production

Cache key design usually gets reworked version by version, after the hit rate numbers turn out ugly:

**Starting point: just cache it.** "Search is slow? Add a Redis cache." The only thought is "cache = the fix", with no thought about what to cache, how to invalidate, or how to build the key.

**Version one: key + TTL.** The cache key is a hash of the query params, TTL 60 seconds, and updates rely on TTL expiry. You know there has to be a key and a TTL, and that staleness is a trade-off, but you have not thought about the hit rate yet. You assume "it is set up, so it works".

**The turning point: questioning the hit rate.** "Wait. This cache key hashes 5 dimensions. **Almost every user's query is different, so the hit rate will be terrible.** The bbox alone is a continuous real number, so the key almost never repeats." Set up does not mean useful. From this version on, you measure the cache hit rate and look at the head query / long tail distribution.

**Fixing for the hit rate:** this version's fix is the set above. Normalize continuous values (snap price to a bucket, snap bbox to geohash), split canonical and user-defined into two paths, multi-tier cache, choose what not to cache (personalized queries), stampede prevention.

**One level up: treat the cache as systems engineering.** The root question is "predict which queries should enter the cache": watch traffic to identify hotspots dynamically (tag the top 100 cache keys automatically and extend their TTL automatically), tiered caches across regions (CDN edge / regional Redis / central Redis), ML for predictive prefetch, compute the cost vs latency curve, defend against cache poisoning. At this stage you watch the hit rate, the Redis bill and the number of stale data complaints at the same time.

---

## The same idea in other domains

This cache key thinking carries straight over to other systems:

### Twitter feed

- **Problem**: user_id × cursor is the cache key, but every user has their own timeline, so the hit rate is near 0
- **Fix**: fan-out on write (when an ordinary user posts, write it into every follower's timeline ahead of time, and read it directly at read time; accounts with huge follower counts merge at read time instead) + cursor normalize

### YouTube video metadata

- **Problem**: video_id as the key, tens of millions of videos, popular videos take 10% of the traffic
- **Fix**: cache popular videos heavily (TTL 1 hour), do not cache the long tail; the personalized homepage gets its own cache for each user

### Uber matching (driver location)

- **Problem**: driver positions change constantly, so individual drivers cannot be cached
- **Fix**: the cache holds "which drivers are inside this [geohash](chunk://geohash) cell"; when a driver moves, only two cells are invalidated (the one entered and the one left)

### URL shortener

- **Problem**: shortcode → original URL is a fixed mapping, but long tail short URLs are the majority
- **Fix**: hot URLs get CDN cache + edge cache, cold URLs query the DB directly (high latency is acceptable)

---

## A decision scenario

A booking platform similar to Airbnb. MAU jumps from 500,000 to 5 million. The ES cluster grows from 6 nodes to 30, and p95 latency still creeps up. The cause after review: popular cities (Tokyo / Paris / NYC) get a few hundred repeated queries per second, but every user drags the map, picks dates and changes filters, so every cache key is different.

Round one: add Redis between the Backend and ES, with a 5-tuple hash as the cache key. One week after launch, the cache hit rate is 8%. A senior colleague frowns at the number: "8%? What did you add this cache layer for?"

Round two: split the canonical and user-defined paths. Place name searches use the canonical bbox (the hash becomes very stable). Map drags use geohash quantization (precision 5). Dates normalize to a week-of-month bucket (2026-12, week 4). Filters are sorted consistently.

After launch the cache hit rate jumps to 47% and p95 latency drops back to 90ms. At the same time the ES cluster shrinks from 30 nodes back to 18 (half the traffic stops at Redis and never reaches ES).

### When would they regret it

A higher cache hit rate is not always better. In this scenario, if the hit rate climbed to 70%, the first thing to check is whether the normalization is too coarse. The coarser the bucket, the more different searches share one result. The user sets $187–412, the key rounds it to $150–450, and the returned results include a $160 listing. One day support gets a wave of complaints: "I set $187 and up, why am I seeing a $160 listing?" The cause: after the client received the cached result, it did not filter again by the user's original range.

The fix is for the client to filter again by the original `price_min` and `price_max`, or to change the price snap from 50 to 25 so fewer listings outside the range get mixed in.
