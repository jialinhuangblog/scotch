---
title: "Change Data Capture (CDC)"
slug: cdc
brief: "Listen to the DB commit log and turn every write into an event stream. Debezium pushes the Postgres WAL into Kafka."
date: 2026-04-28
updated: 2026-07-20
revisions: 2
article: search-geo
---

# Change Data Capture

> Postgres is the source of truth, but search needs Elasticsearch, the cache needs Redis, analytics needs ClickHouse. How do you sync writes out without dual writes?

## The problem: dual writes are unreliable

The app writes Postgres + ES at the same time:

```ts
await postgres.insert(listing);
await es.index(listing);  // ← what if this one fails?
```

The Postgres write succeeds and ES fails. Now Postgres has the row and ES does not, and you have to write compensation logic. The network jitters a little, ES restarts once, and the compensation has to handle a pile of cases.

## CDC: read changes from the DB's WAL

Every DB write is recorded in the [WAL](chunk://wal) (write-ahead log) for crash recovery. A CDC tool listens to the WAL and turns every commit into an event:

```text
Postgres                          Kafka
─────────                         ─────
INSERT listing 101                ┐
  → WAL: { op:'c', after:{...} }  ├→ Debezium reads WAL
UPDATE listing 101 price          ├→ converts to JSON event
  → WAL: { op:'u', before, after}─┘  pushes to topic
DELETE listing 101
```

The app never touches ES, Redis or ClickHouse. **It writes only Postgres, and the downstream subscribes on its own.**

## Debezium's role

Debezium is a Kafka Connect source connector. Its work has two phases:

1. **Initial snapshot**: dump the table's existing data into a Kafka topic
2. **Continuous streaming**: after that, every change flows out of the WAL

It does not connect to the WAL by reading the file. It uses Postgres logical replication: Debezium creates a replication slot and declares to Postgres "I am a replica, send me changes from this position". Postgres uses logical decoding (the `pgoutput` plugin) to decode the physical records in the WAL into individual logical changes (which table, INSERT or UPDATE, before/after values) and sends them to Debezium. The slot remembers the consumption position, so Debezium misses nothing when it disconnects and reconnects.

Downstream consumers each write into ES, Redis, ClickHouse, the data lake.

```text
                            ┌→ ES Consumer    → Elasticsearch
Postgres ── WAL ── Debezium ─┼→ Cache Consumer → Redis
                            └→ Lake Consumer  → S3 / Iceberg
```

## Why it beats dual writes

| Problem | Dual write | CDC |
|---|---|---|
| One side fails | the app writes compensation | Kafka retains, the consumer retries |
| Ordering | each side is async on its own, may go out of order | WAL order = Kafka partition order |
| Adding a downstream | change app code | add one consumer, app untouched |
| App changes schema | both sides change | the app changes Postgres, each consumer handles it |

## Consistency is eventual

CDC is asynchronous:

```text
write Postgres                 t=0
WAL flush + Debezium reads it  t=10ms
push to Kafka                  t=20ms
ES consumer writes             t=2s (ES refresh 1 second)
```

A search right after the write may not see it yet. **A 1-3 second delay is acceptable in most search and analytics cases.** If you need read-after-write, this path does not apply.

To control the format of the outgoing events and avoid exposing the DB schema directly, write an extra outbox table inside the transaction and let CDC listen to that. Covered in [Outbox Pattern](chunk://outbox-pattern).

## Use cases

- **Search index sync**: Postgres → ES
- **Cache invalidation**: write to DB → invalidate the Redis key
- **Microservice decoupling**: the Order service writes the DB, the Notification / Inventory services subscribe to the events
- **Data warehouse / lake**: OLTP data lands in ClickHouse / Snowflake in near real time

---

CDC moves the job of "writing several copies" from app code to the DB's [WAL](chunk://wal). Consistency drops to eventual, in exchange for better fault tolerance and decoupling.
