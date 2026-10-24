---
title: "MVCC"
slug: mvcc
brief: "Several versions of one row, so reads do not have to wait for writes."
date: 2026-03-15
updated: 2026-07-31
revisions: 2
article: storage-deep
---

# MVCC (Multi-Version Concurrency Control)

> A general concept. InnoDB and PostgreSQL both use MVCC, but implement it differently: InnoDB keeps old versions in the undo log, PostgreSQL keeps old and new versions together in the heap.

An UPDATE does not overwrite the original value; it produces a new version. Readers see the old version, writers create the new one, and neither has to wait for the other.

## Without MVCC

The simplest approach locks for both reads and writes. While transaction A reads a row, transaction B has to wait to change it, and the other way around. Reads and writes keep waiting on each other, and concurrency drops sharply.

## The version chain

Every row carries a hidden transaction ID. An UPDATE does not change the original row; it inserts a new version that points back to the old one.

```text
row (id=1):
  version 3: name="Carol"  ← newest
    ↓ points to
  version 2: name="Bob"
    ↓ points to
  version 1: name="Alice"  ← oldest
```

On a read, the DB uses the current transaction's snapshot to decide which version to show. A transaction that started early sees the old version; one that started late sees the new one.

## InnoDB: old versions are moved away

A B+ Tree leaf page keeps only the newest version. The old version that got overwritten is moved somewhere else, called the undo log.

```text
B+ Tree leaf page:
  id=1, name="Carol" (newest version)
         ↓ pointer into the undo log
undo log:
  name="Bob" (previous version) → name="Alice" (earliest version)
```

On a read, if the transaction started early, it follows the pointer into the undo log to find the old version it should see.

Upside: the B+ Tree holds only the newest version, so queries do not have to skip over old data.
Downside: the undo log takes space. If a transaction goes a long time without committing, the undo log keeps growing, because those old versions cannot be dropped (someone still needs to see them).

## PostgreSQL: old and new versions side by side

Nothing is moved. On UPDATE, the old version stays where it is and the new version is written into the same page. Each record is marked with "who created it" and "who expired it".

```text
in the same page:
  id=1, name="Alice" (expired, waiting for cleanup)
  id=1, name="Bob"   (expired, waiting for cleanup)
  id=1, name="Carol" (currently valid)
```

Upside: no separate undo log, so writes are simpler.
Downside: expired data piles up in the page and takes space, and queries have to skip over it. PostgreSQL's built-in autovacuum cleans up expired data automatically and frees the space.

## Relation to the clustered index

This implementation difference decides whether each DB can have a [clustered index](chunk://clustered-index). InnoDB's undo log design keeps only the newest version in the leaf page, so the data can live directly in the B+ Tree, physically ordered by PK, and the clustered index works. PostgreSQL leaves old and new versions at arbitrary positions in the heap, so the physical order was never stable, and a clustered index is not possible.

## The three side by side

MVCC only resolves conflicts between reads and writes. When two people **change** the same row at the same time, a lock has to handle it:

| Mechanism | Which conflict | Holds a spot? | Implemented by |
|---|---|---|---|
| [MVCC](chunk://mvcc) | read vs write | No; reads an old version from the snapshot | DB, automatically |
| [Pessimistic lock](chunk://pessimistic-lock) | write vs write | Takes the spot in advance, others queue | DB, automatically (UPDATE / FOR UPDATE) |
| [Optimistic lock](chunk://optimistic-lock) | write vs write | No; compares the version on write back | Application layer (version + retry) |

MVCC is not on the pessimistic-versus-optimistic axis; it handles the conflict between reads and writes. Only a write-versus-write conflict calls for choosing between the two: when conflicts are frequent, queueing beats retrying over and over, so use a pessimistic lock; when conflicts are rare, the cost of locking in advance is mostly wasted, so use an optimistic lock.
