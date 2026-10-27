---
title: "The short link system as code you can run"
slug: url-shortener-demo
subtitle: "The design from the first three articles, written as code that actually runs."
chapter: "url-shortener"
tags: [url-shortener, go, redis, kafka, clickhouse, postgresql, system-design]
date: 2026-03-29
updated: 2026-10-17
revisions: 1
related: [url-shortener-key, url-shortener-store, url-shortener-read]
---

# The short link system as code you can run

The first three articles covered design and trade-offs. This one wires them into a system that runs.

---

## The three articles in review

This demo maps to the three articles before it:

- **[How to generate the key](article://url-shortener-key)**: long_url → short_key, counter vs hash vs random
- **[How to store it](article://url-shortener-store)**: billions of mappings, read-heavy, where the cache goes
- **[read path](article://url-shortener-read)**: after the user clicks, where the traffic goes and how analytics is collected

---

## System overview

```text
POST /shorten  ─────────────────────────────────────────────────────────
  → id_counter (PG atomic RETURNING)         ← article one: counter approach
  → base62 encode → short_key
  → PG url_mappings (write)
  → Redis url:<key> (pre-warm cache)         ← article two: write-through
  → Redis bloom:urls (SetBit × 5)            ← article two: Bloom filter

GET /:key  ──────────────────────────────────────────────────────────────
  → Bloom filter miss → 404                  ← article three: cache penetration defense
  → Redis url:<key> hit  → long_url
                    miss → PG → populate cache
  → Redis INCR clicks:<key>                  ← article three: real-time count
  → hub.Broadcast(key) → SSE push to dashboard
  → Kafka click-events (fire-and-forget)     ← article three: async analytics
  → 302 redirect

Background  ─────────────────────────────────────────────────────────────
  consumer:  Kafka → ClickHouse click_events ← article three: analytics pipeline
  flush:     Redis clicks:<key> → PG url_stats every 5 seconds  ← article three: flush pattern
```

---

## Design decisions, side by side

### Key generation: DB counter + base62

One `id_counter` table in the DB, with one row:

```sql
UPDATE id_counter SET next_id = next_id + 1 RETURNING next_id;
```

The `UPDATE`'s row lock on that single row serializes calls from several servers, so none of them gets a duplicate ID; `RETURNING` only hands the new value back in the same round trip. The number is then base62 encoded into the short_key.

Counter was chosen over hash because a counter needs no collision check. The Bloom filter here filters **keys that do not exist** (cache penetration); it does not check for hash collisions.

### Bloom filter: hand-built on a Redis bitset

No RedisBloom module. It uses Redis `SETBIT` / `GETBIT` and does the math itself:

```text
bloom:urls (Redis string, used as a bitset)

Add(key):
  hash(key) gives 5 bit positions → SETBIT bloom:urls pos 1 (×5)

Check(key):
  GETBIT bloom:urls pos (×5) → all 1 means "might exist"
  any 0 → "definitely does not exist" → 404 directly
```

The 5 hash functions come from the same key with different seeds. With about 10 bits per key, 5 hashes give a false positive rate of about 1%. The smaller the bitset, the fewer bits each key gets, and the higher that rate goes.

### Redis in three roles

```text
bloom:urls    string (bitset)   Bloom filter
url:<key>     string            cache: short_key → long_url, TTL 10 minutes
clicks:<key>  string            click counter, flushed to PG every 5 seconds
```

### Analytics: Kafka → ClickHouse

On every redirect, the click event goes into Kafka (a fire-and-forget goroutine, no waiting for an ack). The consumer reads from Kafka and writes to ClickHouse in batches:

```text
goroutine: ReadMessage → parse → detect device → rows channel
main loop: 500 rows accumulated or 2 seconds elapsed → PrepareBatch → Append × N → Send
```

ClickHouse uses its native binary protocol (TCP :9000), not SQL text. `PrepareBatch` sends one INSERT header, `Append` streams each row in, and only `Send` actually transmits. One batch is sent once, which is far faster than INSERT per row.

### Real-time dashboard: SSE

On every redirect, `hub.Broadcast(key)` pushes to every browser connected to `/stream`. The browser receives the key and adds 1 to the matching count. No polling.

Every 10 seconds it resyncs (re-sorts from PG total + Redis delta) to prevent drift over long sessions.

### Flush: Redis INCR → PG

The flush runs every 5 seconds:

```text
SCAN clicks:* → GetDel (atomic, fetch and delete)
→ INSERT url_stats ON CONFLICT DO UPDATE total_clicks += val
```

`GetDel` is atomic, so nothing is missed or counted twice. A server restart loses at most 5 seconds of click counts, which is acceptable for analytics.

---

## How it differs from production

| Feature | Demo | Production |
|---|---|---|
| Key generation | single PG counter | counter service (ZooKeeper / etcd range allocation) |
| Bloom filter | hand-built on a Redis bitset | RedisBloom module |
| Sharding | none (single PG) | consistent hashing, several PG shards |
| CDN | none | CDN caches the 302 to reduce origin load |
| Real-time | SSE | SSE or WebSocket |
| Analytics DB | ClickHouse (local) | ClickHouse cluster |
| Click count | Redis INCR + 5s flush | same, or add HyperLogLog for unique visitors |

The demo leaves out sharding and CDN on purpose, so every data flow stays visible. The core logic is the same as production.

---

## How to run it

```bash
make setup          # start infra (Docker) + create schema
make run-shortener  # terminal 1
make run-consumer   # terminal 2
make run-flush      # terminal 3
make seed           # insert 50,000 fake rows (safe to repeat, adds 50k each time)
make traffic        # simulate traffic (80/20 Zipf, a few URLs take most of the clicks)
```

Dashboard: http://localhost:8080
Analytics: http://localhost:8080/analytics

Reset: `make db-prune` (stop the consumer first, or the old events in its buffer get written into the new ClickHouse).
