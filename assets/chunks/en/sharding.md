---
title: "Sharding"
slug: sharding
brief: "Split data across multiple machines. Hash sharding makes range queries scan every shard; range sharding tends to pile the newest data on one machine."
date: 2026-03-15
updated: 2026-03-27
revisions: 1
article: storage-deep
---

# Sharding

> A general concept. MongoDB has sharding built in; MySQL/PostgreSQL need a proxy (Vitess, Citus) or have to do it in the application layer.

When one DB cannot handle the load, spread the data across several. Each one stores only part of the data and is called a shard.

## Partition vs Sharding

The two are often mixed up, but they differ:

```text
Vertical partition:   split by column (columns A-C on one side, columns D-F on the other)
Horizontal partition: split by row (keys 0-999 in one group, keys 1000-1999 in another)
Sharding:             horizontal partitions spread across different machines
```

```text
Horizontal partition (same machine):
  DB Server A
    ├── partition_0 (key 0-999)
    └── partition_1 (key 1000-1999)

Sharding (across machines):
  DB Server A → shard_0 (key 0-999)
  DB Server B → shard_1 (key 1000-1999)
```

All sharding is horizontal partitioning, but not all partitioning is sharding. Partitions on the same machine solve query performance and data management (for example, partition by month, and delete old data by dropping the partition). Sharding solves volume one machine cannot handle (CPU, disk or QPS beyond the limit of a single machine).

## Two ways to split

### Hash Sharding

`shard = hash(key) % N`. Data spreads evenly, with no hot spot.

The problem: a range query like `WHERE created_at BETWEEN ...` has to scan every shard, because hashing destroyed the order.

### Range Sharding

Split by key range. `id 1–1000` on shard 0, `1001–2000` on shard 1. A range query only needs to scan one or a few shards.

The problem: if keys are unevenly distributed (for example, the newest ids all land on the last shard), hot spots form easily.

## Choosing the shard key

The shard key decides how data is spread, and which queries can be served by a single shard. Pick the wrong one and resharding is hugely expensive.

A good shard key: high cardinality (many distinct values), used often in queries, evenly distributed.

A bad shard key: low cardinality (for example `country`, only a few dozen values), almost never used in queries.

## Resharding

The business grows, the original shards are not enough, and shards have to be added. With `hash % N`, once N changes, almost all data has to move (rehash).

Consistent hashing reduces the amount moved; adding one machine moves only about 1/N of the data. But in practice resharding is still a major project, needing double-write, verification and cutover.

## Cross-Shard Query

`JOIN` on two tables: if the data sits on different shards, the DB cannot JOIN directly. Either combine in the application layer, or place related data on the same shard (co-locate).

MongoDB's `mongos` router splits a cross-shard query into several subqueries and merges the results. Performance is far below a single-shard query.

---

Hash spreads evenly, but range queries scan every shard. Range keeps the order, but the newest data tends to collect on the last shard. Choosing the shard key is close to a one-time decision; changing it later is very expensive.
