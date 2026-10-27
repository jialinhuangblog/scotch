---
title: "Geohash & Geo Search"
slug: geohash
brief: "Encode latitude and longitude as a string; the longer the prefix, the smaller the area. The indexing method for geographic range queries."
date: 2026-04-28
updated: 2026-10-17
revisions: 1
article: search-geo
---

# Geohash & Geo Search

> For the query "find restaurants within 5 km", the DB cannot just compare two latitude and longitude floats pair by pair. How do you turn a location into an indexable string?

## The problem: latitude and longitude cannot be indexed directly

```sql
-- find points within a 5km radius
SELECT * FROM places
WHERE distance(location, my_location) < 5;
```

`distance()` has to be computed for every row. A full table scan over 10M rows is slow.

A B-tree indexes the order of a single column, but "two dimensions of latitude and longitude" have no natural order.

## Geohash: squeeze two dimensions into one

Cut the map into a grid and give each cell a string code. **The longer the prefix, the smaller the cell**:

```text
u0      → a large part of western Europe
u09t    → around Paris (about 39km × 20km)
u09tunq → one neighborhood in Paris (about 150m × 150m)
```

Every extra character shrinks the area 32 times. **Points in the same cell share a prefix**:

```text
restaurants near the Eiffel Tower:    u09tunq...
restaurants near the Arc de Triomphe: u09twh4...
common prefix: u09t → in the same area
```

A geohash is a string, so it can take a B-tree index. "Near Paris" becomes `WHERE geohash LIKE 'u09t%'`.

## Common geo queries

| Query | How |
|---|---|
| **Bounding box** (the map viewport) | given the lower left and upper right coordinates, take every point inside the box |
| **Radius** (within 5km) | compute the geohash precision that matches 5km, compare the relevant cells |
| **Polygon** (administrative boundaries) | is the point inside the polygon; needs a GIS engine such as PostGIS |

## The boundary problem

Geohash cuts the earth into squares, and **points on opposite sides of a boundary have completely different prefixes** while being physically close:

```text
(grid boundary)
  ezzpb... | ezzpc...
        ↓
   the two points are 50m apart, yet the prefix differs from the fifth character on
   if they happen to sit on opposite sides of a larger grid line, even the first character may differ
```

So a query **takes the target cell + the 8 surrounding cells = 9 prefixes**, fetches all of them, then filters by actual distance. Redis GEOSEARCH does exactly this internally; Elasticsearch moved geo_point to a Lucene BKD tree in 5.x and no longer relies on geohash cells.

## Implementation choices

| Tool | Fits |
|---|---|
| **PostGIS** (Postgres extension) | pure SQL environments, polygon computation, administrative boundaries |
| **Elasticsearch geo_point** | integrated with a [search](chunk://elasticsearch) workload (filter + ranking + facets together) |
| **Redis GEOADD / GEOSEARCH** | pure geo queries, low latency, modest volume, no complex filters |
| **MongoDB 2dsphere** | document store environments, convenient |

If geo queries are themselves the main search workload, use ES; if they are only a secondary query, use Redis or PostGIS.

## Marker Cluster

Zoom the map out to a country view and one viewport holds 100,000 points; the frontend cannot draw them all. Aggregate by the geohash precision that matches the zoom level, and **return one cluster center + count per cell**:

```text
zoom 5  → geohash precision 3 → ~50 clusters nationwide
zoom 10 → geohash precision 5 → ~30 clusters in one city
zoom 15 → geohash precision 7 → show individual markers
```

ES's `geohash_grid` aggregation does exactly this.
