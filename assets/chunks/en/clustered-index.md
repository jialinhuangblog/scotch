---
title: "Clustered Index"
slug: clustered-index
brief: "What decides the physical order of rows on disk. InnoDB ties it to the PK, PostgreSQL has none, SQL Server lets you choose."
date: 2026-03-15
updated: 2026-07-20
revisions: 4
article: storage-deep
---

# Clustered Index

The basics of indexes and B+ Trees are in [index-basics](chunk://index-basics).

The bottleneck in disk reads is the seek: finding the position takes far longer than reading the data itself. If related data is scattered across the disk, every row costs a seek. If related data sits together, one seek reads a whole page and brings back a few hundred rows.

A clustered index stores the data on disk sorted by some key. A range query (`WHERE id BETWEEN 100 AND 200`) becomes a sequential read, with no seeking back and forth across the disk.

## Definition

A clustered index has to satisfy all of the following:

1. **Physical order**: the actual order of data on disk is decided by some key
2. **Data lives in the leaf**: the B+ Tree leaf page holds the whole row, so reaching the leaf means having the data
3. **At most one per table**: data can only be physically arranged in one order

Choosing the clustered index means deciding which query pattern matters most. Sorted by `id`, it cannot also be sorted by `created_at`.

The clustered index defines the physical structure of the whole table. InnoDB data always lives in some B+ Tree, so every table has a clustered index. When no PK is declared, InnoDB first looks for the first UNIQUE index whose columns are all NOT NULL and uses that as the clustered index. Only if there is no such index does it create a hidden row ID (`GEN_CLUST_INDEX`).

## Page: the smallest unit of disk IO

A DB does not read one row at a time. It reads one page at a time (usually 16KB). A page holds a few dozen to a few hundred rows. The disk bottleneck is the seek (finding the position); once found, reading 16KB sequentially costs almost nothing. So reading and writing by page is far faster than by row.

Every node of a B+ Tree is a page. All IO in the DB is built on pages.

This page has nothing to do with API pagination.

## How each DB does it

### InnoDB (MySQL)

The PK is always the clustered index. There is no choice. Data lives directly in the leaf pages of the PK B+ Tree, sorted by PK.

```text
PK B+ Tree leaf page:
| id=1, name="Alice", email="a@x.com" |
| id=2, name="Bob",   email="b@x.com" |
| id=3, name="Carol", email="c@x.com" |
```

`WHERE id = 2` walks the B+ Tree to the leaf, and the data is right there. One IO.

Every secondary index (an index on email, for example) stores the PK value in its leaf. After looking up a secondary index, the DB takes the PK back to the clustered index and looks up again.

With an auto-increment ID as PK, new rows always append to the last leaf page, which performs best. With a UUID as PK, every INSERT may land in the middle of the B+ Tree and trigger a page split (one full page split into two), so write performance drops.

### PostgreSQL

No clustered index, and no way to create one by hand, because PostgreSQL data lives in a heap and the index is a separate structure. The two never merge. A clustered index requires "data lives in the index leaf", and the heap model does not fit that requirement.

The root cause is how [MVCC](chunk://mvcc) is implemented. A PostgreSQL UPDATE writes the new version to any heap location with free space, and the old version stays where it was, waiting for VACUUM. If data had to be physically sorted by PK, the new version could not go just anywhere, which conflicts with MVCC's append-anywhere model. InnoDB can have a clustered index because its MVCC moves old versions into the undo log. The leaf page only ever holds the latest data, so the physical order of the B+ Tree is never disturbed.

This heap is not the heap from a data structures textbook (the priority queue). It is "a pile of pages with no order". A new row finds a page with free space and goes in. No order is promised.

```text
Heap (no order):
slot 0: { id=3, name="Carol" }
slot 1: { id=1, name="Alice" }
slot 2: { id=2, name="Bob"   }

PK Index (a separately built B+ Tree):
| id=1 → slot 1 | id=2 → slot 2 | id=3 → slot 0 |
```

Every index (including the PK) is secondary. After looking up an index, the DB usually has to go back to the heap for the data, one extra step. The exception is the index-only scan: all the columns the query wants are in the index, and the heap page is marked all-visible in the visibility map, so there is no need to go back to the heap.

PostgreSQL has a `CLUSTER` command that rewrites the heap in the order of some index, but it is a single physical reorder. New rows afterwards do not keep that order.

### SQL Server

The PK is the clustered index by default, but another column can be chosen. Set `created_at` as the clustered index, for example, and the data is sorted by time. That suits query patterns on time series data.

## Storage layout also decides UPDATE and cleanup

How data is stored also decides how UPDATE behaves, where old versions go, and how they get cleaned up. InnoDB against PostgreSQL:

| Design decision | InnoDB | PostgreSQL |
|---|---|---|
| Data storage | Clustered index (data in the leaf) | Heap (unordered) |
| UPDATE behavior | Change in place | Write a new version, the old one stays |
| Where old versions go | Undo log (somewhere else) | In the original heap page |
| Cleanup | Undo log purge | VACUUM |

The two databases enter this set of decisions from opposite ends:

**InnoDB starts from "fast PK lookup" and works down**: wants a clustered index → UPDATE has to change in place (otherwise the B+ Tree cannot keep its order) → old versions need somewhere else to go → invent the undo log to store them. On this chain the clustered index is the starting point and the undo log is the companion forced into existence.

**PostgreSQL starts from the no-overwrite philosophy and works down**: UPDATE always writes a new version → the new version goes to any heap location → the heap has no physical order → a clustered index is impossible.

So "which came first, the clustered index or the undo log" has no universal answer. Ask the InnoDB team: the clustered index came first. Ask the PostgreSQL team: they never considered a clustered index at all; the whole design unfolds around no-overwrite.


## Choosing the PK

Whether the benefit of a clustered index can be used at all depends directly on whether the PK is a UUID or incremental. That is written up in [PK choice](chunk://primary-key-choice).

## Trade-offs

| | Clustered (InnoDB) | Heap (PostgreSQL) |
|---|---|---|
| PK lookup | Fast, one step | One extra step, back to the heap |
| Write | Has to keep B+ Tree order | Append directly, fast |
| UPDATE | In place (if the page has room) | Write a new version, mark the old one dead, wait for VACUUM |
| Space | Data stored once | Old versions stay in the heap until VACUUM clears them |

Where reads dominate, the clustered index has the advantage. Where writes dominate, the heap's append is faster. In practice this difference is rarely what decides the choice of DB.
