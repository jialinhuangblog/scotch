---
title: "DB Table Partition"
slug: db-partition
brief: "One large table split into several pieces on the same machine. Splitting by month is the most common; deleting old data is dropping one whole piece."
date: 2026-06-12
updated: 2026-10-18
revisions: 2
article: storage-deep
---

# DB Table Partition

> A table has grown until queries are slow and deleting old data takes forever, but it is not yet big enough to spread across machines. What then?

## Same machine, table split into pieces

A partition splits one logically large table into several physical smaller pieces on the **same DB**. To the application it is still one table; the DB stores the pieces separately underneath. The difference from [sharding](chunk://sharding) is that a partition stays on one machine and sharding crosses machines. All sharding is partitioning, but a partition does not have to cross machines.

The most common form is a **horizontal partition (split by row)**: one piece per month by `created_at`, or pieces by `id` range, each piece a child table. This is a native DB feature (`PARTITION BY RANGE`); the app still sees one table, and the DB routes each row to the right piece on its own. Like a big filing cabinet with one drawer per month: to find March, pull out the March drawer, no need to go through the whole cabinet.

## A vertical partition is really splitting the table

A **vertical partition (split by column)** is a different thing: store the large, rarely used columns (an article's body, a user's avatar) apart from the small, frequently used ones, so a read does not load columns it will not use.

But in Postgres/MySQL this is not a native feature. There is no `PARTITION BY COLUMN` syntax. What gets called a vertical partition means you `CREATE TABLE users_basic` and `users_extended` yourself and JOIN them yourself when querying. The DB does not know they were once one table.

Taken to the extreme, **every column stored separately** is columnar storage, the foundation of OLAP systems like ClickHouse, Parquet, and BigQuery. Querying 3 of 100 columns reads only those 3, and values of the same type stored together compress very well.

## Why split

**Queries touch only the relevant pieces (partition pruning)**: `WHERE created_at >= '2026-05-01' AND created_at < '2026-06-01'` scans only the May piece; the DB skips the others on its own. The upper bound is "before June 1" because `created_at` is a timestamp. Written as `BETWEEN '2026-05-01' AND '2026-05-31'`, the `'2026-05-31'` is read as May 31 00:00:00, so every row after 00:00 on the 31st is left out, with no error message at all.

**Deleting old data gets cheap**: to clear data older than a year, `DROP PARTITION` pulls out the whole piece, instead of `DELETE` row by row (which also leaves a pile of dead rows waiting for vacuum).

## The cost

Once chosen, the partition key is hard to change. And a query that does not include the partition key has to scan every piece, no faster than without partitioning. Partitioning pays off only when queries usually touch a small range.
