---
title: "PK Choice: UUID vs Incremental"
slug: primary-key-choice
brief: "UUIDv4 as an InnoDB PK keeps splitting pages, and the randomly loaded pages push hot data out of the buffer pool; the fixes are UUIDv7, two keys, or switching to a heap model."
date: 2026-07-20
---

# PK Choice: UUID or Incremental?

A [clustered index](chunk://clustered-index) brings three benefits: a PK lookup lands in one step, a range scan reads contiguously, and inserts are sequential appends with no page split. How many of the three does each PK choice get?

| Benefit | incremental ID | UUIDv4 (random) |
|---|---|---|
| PK lookup in one step | ✓ | ✓ |
| Contiguous range scan | ✓ | Unused (who writes `WHERE uuid BETWEEN`) |
| Sequential insert | ✓ | ✗ |

UUIDv4 gets only the first. A range scan means nothing for UUIDs, because nobody queries by UUID range; sequential insert is lost entirely.

## Why UUIDv4 drags down writes

With an incremental ID, every INSERT hits the rightmost leaf page:

```text
INSERT id=1001, 1002, 1003, ...
→ all go into the same leaf page (the rightmost one)
→ when it fills up, create the next one and keep appending
→ zero random IO, buffer pool hit rate close to 100%
```

UUIDv4 is fully random, so every INSERT hits a different leaf page:

```text
INSERT a7f3..., 2b1c..., f4d9..., ...
→ touches a different leaf every time
→ if that leaf is not in the buffer pool, read it from disk first (random IO)
→ if the leaf is full, page split
→ the buffer pool fills with random pages, hot data gets pushed out
```

In [Percona's experiment](https://www.percona.com/blog/illustrating-primary-key-models-in-innodb-and-their-impact-on-disk-usage/), pages under an auto-increment PK fill to about ninety percent, while under a random UUID PK they fill to only about fifty percent because pages keep splitting; the same data used two to three times the disk space.

## Fixes

**1. Use a UUID ordered by time (UUIDv7 / ULID)**

The first 48 bits are a timestamp, the rest is random. It still looks like a UUID, and values increase roughly in generation order:

```text
UUIDv4 random:   a7f3... 2b1c... f4d9...     ← position jumps everywhere
UUIDv7 ordered:  01860... 01861... 01862...  ← ordered append
```

INSERT becomes a sequential append again, and write performance is close to auto-increment.

**2. Two keys**

The PK is auto-increment, so InnoDB's INSERT stays a sequential append, and the UUID is a secondary key for external use:

```sql
CREATE TABLE users (
  id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid      CHAR(36) UNIQUE,
  ...
);
```

The public API exposes only `uuid` (prevents ID guessing, and no collisions when merging different DBs); internal JOINs and foreign keys use `id`. The cost is one more unique index.

**3. Switch to PostgreSQL**

Under PostgreSQL's heap model the PK is just a secondary index, so a UUID hurts writes far less. Index fragmentation still happens, but nowhere near as badly as in InnoDB.

## Conclusion

The conditions for a clustered index to work are loose: any sortable key will do. But getting all of the performance benefits requires a key that increases monotonically.
