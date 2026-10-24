---
title: "Elasticsearch"
slug: elasticsearch
brief: "Search, filter, sort, aggregate, and geo query packed into one query. A Lucene index plus a REST API."
date: 2026-04-28
updated: 2026-09-01
revisions: 1
article: search-geo
---

# Elasticsearch

> Postgres's LIKE '%keyword%' gets unbearably slow past a million rows. Why hand search work to a dedicated engine?

## The scenario

Airbnb search: the user enters "Tokyo + 12/20-12/27 + 2 guests + wifi + budget 50-300". Among 7M listings the system has to:

1. Match text ("Tokyo" against city or description)
2. Filter by geography (inside Tokyo's bounding box, that is, the map frame)
3. Combine several filters (amenities, price range, room type)
4. Sort by relevance + rating
5. Compute facets along the way (how many listings per amenity, for the UI to show)

Postgres has a hard time doing all of this in one query, and even when it can, it is slow.

## Inverted index: the core of search

A Postgres B-tree is "give me an id, I give you the row". An inverted index is the reverse: "give me a term, I give you every doc it appears in".

```text
term     → doc IDs
"tokyo"  → [101, 203, 405, ...]
"loft"   → [101, 502, 703, ...]
"wifi"   → [101, 102, 105, ...]

search "tokyo loft wifi"
  → intersect the three lists → [101, ...]
```

[Search inverted index](chunk://search-inverted-index) covers the principle; ES uses Lucene to build it into an engine that can go to production.

## One query does several things at once

```json
{
  "query": {
    "bool": {
      "must":   [{ "match": { "description": "loft" } }],
      "filter": [
        { "geo_bounding_box": { "location": { ... } } },
        { "range": { "price": { "gte": 50, "lte": 300 } } },
        { "term":  { "amenities": "wifi" } }
      ]
    }
  },
  "sort": [{ "_score": "desc" }, { "rating": "desc" }],
  "aggs": {
    "amenity_counts": { "terms": { "field": "amenities" } },
    "price_histogram": { "histogram": { "field": "price", "interval": 50 } }
  }
}
```

To do this in Postgres you need its own full-text search (FTS), PostGIS, several GIN / GiST indexes (the two index types Postgres offers for full text and geo data), plus GROUP BY for the facets. It can be done, but the query is complex and the optimizer does not always pick the right plan. ES finishes it in one request.

## Living alongside Postgres

The source of truth is still Postgres. Writes:

```text
Host edits listing → write Postgres
                ↓
            CDC (Debezium) listens to the WAL
                ↓
            push to Kafka
                ↓
            consumer writes ES
```

[CDC](chunk://cdc) streams the write events out, and ES acts as a derived view. A sync delay of 1-3 seconds is acceptable.

**Why not dual writes**: if app code writes Postgres + ES at the same time and one side succeeds while the other fails, they are inconsistent and you have to write compensation logic. CDC leaves the consistency problem to Kafka's retain + replay.

## Limits

- **Not a transaction store**: writes are near real time, refresh defaults to 1 second. Read right after a write and it may not be visible yet. Every refresh produces a new Lucene segment; once written, a segment is never modified, and a background [merge](chunk://compaction) folds small segments together. [LSM Tree](chunk://lsm-tree) needs compaction for the same reason: when data can only be appended and never changed in place, background merging is required. During a merge, the term dictionary is sorted and merged again with a k-way merge, while the raw document contents (stored fields) can be copied over as whole blocks when the source segment has no deletions.
- **Once the schema settles, changing the mapping means reindexing**: change a field type or analyzer and the whole index has to be rebuilt.
- **Heavy memory use**: field data and caches live on the heap. **Capacity planning takes more care than with Postgres**.
- **Not for the main transactions**: booking and payment go through Postgres, search goes through ES.

## When to use it

- Text search that needs a relevance score → ES (Postgres FTS works too, but is more basic)
- Geo + filter + facets in one query → ES
- Log analytics (ELK stack) → ES
- Pure key-value lookup, strong transactions → not ES
