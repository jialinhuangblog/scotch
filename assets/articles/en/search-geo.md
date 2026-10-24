---
title: "Dragging the map triggers a refetch, but there are seven million listings"
slug: search-geo
subtitle: "Text match, geo range and facets are hard to fit into one Postgres query. How Elasticsearch, geohash and CDC split the work."
chapter: "search"
tags: [elasticsearch, geohash, cdc, search]
date: 2026-04-28
updated: 2026-10-17
revisions: 1
related: [search-cache]
---

# Dragging the map triggers a refetch, but there are seven million listings

Airbnb's search page is a column of listings on the left and a map on the right. Drag the map and the query runs again. Underneath, it has to do a text match, a geo filter, several condition filters, a sort by relevance plus rating, and compute facets on the side (how many listings have each amenity).

Airbnb has roughly 7 to 8 million listings ([about 7 million in 2023, about 8 million in 2024](https://www.demandsage.com/airbnb-statistics/)). MAU and queries per second are not published, so this design assumes the scale of "hundreds of millions of users, thousands of queries per second".

These requirements are hard to push into a single Postgres query, and even if you can write it, it is slow. `ILIKE` scans row by row over millions of rows, and FTS plus PostGIS plus a GIN index plus a GROUP BY for facets does not guarantee the optimizer picks the right plan. So the search workload is split between [Elasticsearch](chunk://elasticsearch), Postgres and [CDC](chunk://cdc).

---

## Breaking down the requirements

```text
Search page
  ├── location: "Tokyo" / bbox / radius
  ├── dates: 12/20-12/27
  ├── guests: 2 adults
  ├── filters: price 50-300, wifi, kitchen, entire_place
  ├── sort: relevance / price / rating / newest
  └── facets: "wifi 800, pool 230" ← the UI shows this

  ↓

Result
  ├── 20 listings (list + map markers)
  ├── facets count
  └── cursor for the next page
```

Drag the map and the query has to run again at once, and each of these six dimensions needs a different index:

- Text search → needs an [inverted index](chunk://search-inverted-index)
- Geo range → needs [geohash](chunk://geohash) / R-tree (a spatial index that wraps a group of points in a rectangle and splits it level by level)
- Filter combinations → need composite indexes over several columns
- Ranking → needs a score function
- Facets → need group by + count
- Pagination → offset becomes O(N) at volume

Doing all of it in one DB engine costs too much. **ES leads the search path, Postgres stays the source of truth**.

---

## Why Elasticsearch

One [ES](chunk://elasticsearch) query does all of this at once:

```json
{
  "query": {
    "bool": {
      "must":   [{ "match": { "title": "loft" } }],
      "filter": [
        { "geo_bounding_box": { "location": { ... } } },
        { "range": { "price_per_night": { "gte": 50, "lte": 300 } } },
        { "term":  { "amenities": "wifi" } }
      ]
    }
  },
  "sort": [{ "_score": "desc" }, { "rating_avg": "desc" }],
  "aggs": {
    "amenity_counts": { "terms": { "field": "amenities" } },
    "price_histogram": { "histogram": { "field": "price_per_night", "interval": 50 } }
  }
}
```

Text match + geo + range + term filter + sort + facets, all in one round-trip. Postgres can do it, but it takes three extensions, the query plan is complex, and every extra filter brings a new chance of the wrong index being chosen.

**Where ES does not fit**: transactions, strong consistency, lookup by PK. Booking and payment must never move to ES.

```text
Write path: app → Postgres (source of truth)
  ↓
  CDC → Kafka → ES consumer → Elasticsearch (derived view)

Read path:
  Search → ES
  Booking detail → Postgres
  Listing detail (clicked from search results) → Postgres + Redis cache
```

Postgres is the source of truth, ES is a derived view. [CDC](chunk://cdc) keeps them consistent.

---

## Three query modes for geo search

| Mode | Scenario | How to query |
|---|---|---|
| **Bounding box** | the map viewport is dragged | give the bottom left and top right coordinates, take everything inside |
| **Radius from point** | "within 5km of central Paris" | give a center + radius |
| **Polygon** | "the Brooklyn area" | give the polygon boundary (rare in practice) |

ES indexes a `geo_point` field with a BKD tree internally (only very early versions used [geohash](chunk://geohash) prefixes), and all three modes run on it. Postgres needs PostGIS for the equivalent.

### Marker Cluster (when zoomed out)

Zoom the map out to a whole country, and one viewport holds 100,000 points. The frontend cannot draw that many markers. Three options:

1. **Server side geohash aggregation**: the ES `geohash_grid` agg aggregates at the precision matching the zoom level and returns each cell's geohash + count (add a `geo_centroid` sub-agg for the marker position)
2. **supercluster.js on the frontend**: the server returns raw points and the frontend clusters them. With a large data set the frontend stalls
3. **Precomputed tile based aggregation**: pre-aggregate listings into tiles offline, and the frontend fetches the tile for its zoom level. Fastest, but the build pipeline is heavy

In practice (1) is the default and (3) speeds up popular cities.

---

## Availability: the time dimension filter

The `dates` filter is awkward because:

- Every listing has a calendar (dates already booked)
- Search has to filter down to listings nobody has booked for this date range
- The calendar changes often (every booking triggers a change), which does not suit ES (index churn)

Two solutions:

**A. Store an `availability_bitmap` or `blocked_until` in ES**
Tolerate a few seconds of sync delay. Between the booking completing and ES updating there is a race window. A user may see "available" and find it unavailable after clicking in. **UX fix: verify again on the detail page**.

**B. Two-phase search**
ES fetches candidates (ignoring availability), then the ID list goes to Redis / an availability service for a batch availability check, and the filtered result is returned. **One more round trip, but the data is fresh**.

This design uses (A) with the UX fallback as the default, and moves to (B) only when fresher data is needed.

---

## Ranking: two stages

Sorting by distance and price alone ignores reviews, listing quality and user preference. Ranking here has two stages:

### Stage 1: Retrieval (coarse ranking)

ES pulls the top 1000 candidates with a basic score (geo + filter + simple boost). Fast, cheap, scales horizontally.

### Stage 2: Re-ranking (fine ranking)

An ML model rescores the 1000 candidates. Features:

- **Listing quality**: rating_avg, review_count, response_rate, host_superhost
- **User personalization**: past click / book / wishlist patterns
- **Price competitiveness**: vs nearby listings of the same tier
- **Diversity**: not all the same room type / price band / host
- **Recency**: a cold start boost for new listings

Model: gradient boosted tree (XGBoost / LightGBM) or a small DNN. Training data: booking outcomes (positive = booked, negative = clicked but not booked).

Online tuning: A/B test different parameters, reweight in real time from user click feedback.

---

## Splitting the schema

### Postgres (source of truth)

```sql
CREATE TABLE listings (
  id UUID PRIMARY KEY,
  host_id UUID NOT NULL,
  title TEXT,
  description TEXT,
  location GEOGRAPHY(POINT, 4326),
  city_id UUID,
  bedrooms INT,
  price_per_night NUMERIC(10, 2),
  amenities TEXT[],
  room_type TEXT,
  rating_avg NUMERIC(3, 2),
  review_count INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX listings_location_gix ON listings USING GIST (location);
CREATE INDEX listings_city_id_idx ON listings (city_id);

CREATE TABLE bookings (
  id UUID PRIMARY KEY,
  listing_id UUID REFERENCES listings(id),
  guest_id UUID,
  check_in DATE,
  check_out DATE,
  status TEXT
);
CREATE INDEX bookings_listing_dates_idx ON bookings (listing_id, check_in, check_out);
```

### Elasticsearch index

```json
{
  "mappings": {
    "properties": {
      "id":             { "type": "keyword" },
      "title":          { "type": "text" },
      "location":       { "type": "geo_point" },
      "price_per_night":{ "type": "float" },
      "bedrooms":       { "type": "integer" },
      "amenities":      { "type": "keyword" },
      "room_type":      { "type": "keyword" },
      "rating_avg":     { "type": "float" },
      "review_count":   { "type": "integer" },
      "host_superhost": { "type": "boolean" },
      "blocked_until":  { "type": "date" }
    }
  }
}
```

### Sync strategy

```text
Postgres ── WAL ── Debezium ── Kafka topic ── ES consumer ── Elasticsearch
                                          │
                                          ├── Cache invalidator → Redis
                                          └── Analytics → ClickHouse
```

[CDC](chunk://cdc) broadcasts a single write to several downstream consumers. A sync delay of 1-3 seconds is acceptable. On failure Kafka retains the messages and they are replayed by hand.

---

## API design points

```ts
POST /api/v1/search
{
  "location": { "type": "bbox", "coords": [...] }
              | { "type": "place_id", "id": "ChIJ..." }
              | { "type": "radius", "center": [...], "km": 5 },
  "dates": { "check_in": "2026-12-20", "check_out": "2026-12-27" },
  "guests": { "adults": 2 },
  "filters": { "price_min": 50, "price_max": 300, "amenities": ["wifi"] },
  "sort": "relevance",
  "pagination": { "cursor": "...", "limit": 20 }
}
```

- **One `location` field, three modes** (bbox / place_id / radius): the frontend picks one from the UI state
- **`facets` come back with the search**, so options with a count of 0 are greyed out up front, instead of the user picking one and only then finding there are no results
- **`cursor`, not `offset`**: paging far with offset makes every ES shard fetch from + size rows and merge them, and beyond 10,000 rows ES rejects the request by default. A cursor (`search_after`) continues from the last row of the previous page
- **`total_count_estimate`** is not guaranteed exact. An exact count over a large result set is slow; an estimate is enough

---

## Edge cases

| Scenario | Handling |
|---|---|
| "Paris" is ambiguous | Autocomplete disambiguates up front and sends a place_id, not a string |
| Dates across the new year (12/30 → 1/3) | Parse the dates correctly, do not split them into two segments by year |
| 0 results | Fall back to nearby areas / relax the dates / drop the strictest filter |
| Extreme zoom out | Cluster aggregation |
| Just booked but ES not yet synced | Verify again on the detail page, offer alternative listings |
| Host removes a listing | CDC notifies ES to delete it; gone from search results within 1-3 seconds |
| Mobile vs desktop | Mobile has no room for side by side; switch to a toggle mode |
| Bots sending search requests in volume | [Rate limit](chunk://rate-limiter) per IP / per session |

---

## A decision scenario

A hotel booking startup. The MVP has only 5,000 listings, all running on Postgres + PostGIS. Monthly GMV starts passing a million, listings climb to 80,000, and product wants to add an amenity filter + autocomplete + map clusters.

First pressure point: the amenity filter. listing.amenities is an array. Postgres queries `array @> ['wifi','kitchen']` through a GIN index, and with price range, bbox and city_id, four or five filters together, the query plan starts picking the wrong index and queries over 10 seconds appear.

Second pressure point: facets. Every search has to GROUP BY amenity to count. 80,000 rows is still fine, but the forecast is over 500,000 by year end, more than six times the rows for GROUP BY to work through.

Decision: bring in [Elasticsearch](chunk://elasticsearch). Postgres stays the source of truth, [Debezium](chunk://cdc) reads the WAL and pushes to Kafka, a consumer writes to ES. The whole search workload goes through ES. Booking, payment and host CRUD stay untouched.

Done in two months. p95 search latency dropped from 3.5s to 80ms. Facets went from "a separate endpoint computes them" to "they come back in the same query as the search".

### When would they regret it

ES is a derived view, and its consistency is eventual. One day support receives a complaint: "I removed my listing and it still shows in search results". Sync delay can reach minutes when ES restarts, Kafka lags or a consumer is stuck, and then these have to be added:

1. Change the ES delete to a soft delete + a `hidden` flag, and filter that flag out of search
2. Monitor Kafka consumer lag, alert above 30 seconds
3. Verify again on the detail page (a second check)

If the business turns into "a removed listing must disappear at once, a 5 second delay is not acceptable", then some search path (for example city_id + simple filters) has to route back to Postgres, with ES running only the complex queries.

---

## Sources

- Airbnb active listings: about 7 million in 2023, about 8 million in 2024, [demandsage Airbnb Statistics](https://www.demandsage.com/airbnb-statistics/) (compiled from Airbnb's official financial reports). Airbnb has not published MAU or queries per second; the scale used in this article is an assumption.
