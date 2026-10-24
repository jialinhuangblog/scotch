---
title: "Index Basics"
slug: index-basics
brief: "Without an index, every query is a full table scan. With one, the query walks a B+ Tree and finds the row in 3 to 4 IOs among hundreds of millions."
date: 2026-03-28
updated: 2026-10-17
revisions: 3
---

# Index Basics

Without an index, a query is a full table scan: it scans from the first row to the last to find the ones that match. One hundred million rows means one hundred million checks.

An index is a separate B+ Tree built to speed up queries.

## The structure of a B+ Tree

Data lives only in the leaf nodes (the bottom level); internal nodes hold only keys for navigation. Each node is one page (16KB in InnoDB, 8KB in PostgreSQL) and can hold a few hundred keys.

```text
         [50]
        /    \
    [20,30]  [70,90]
    /  |  \    |   \
[..][..][..]  [..] [..] ← leaf, the data is here
```

The tree is usually 3-4 levels deep, so hundreds of millions of rows take at most 4 IOs to find.

## Primary vs Secondary Index

**Primary index (PK)**: one per table, created automatically when you declare the PK.

**Secondary index**: created by hand, and there can be many.

```sql
CREATE INDEX ON users(email);    -- secondary
CREATE INDEX ON orders(user_id); -- secondary
```

```text
Primary index leaf:
  id=1 → { name="Alice", email="a@x.com", ... } (the whole row, or a pointer to where the row is)

Secondary index leaf:
  email="a@x.com" → id=1 (only the PK, not the whole row)
```

A secondary index leaf stores only the PK. So after a lookup in the secondary index finds the email and gets the PK, it still has to go back to the primary index for one more lookup to get the full row. This is how InnoDB does it. A PostgreSQL index leaf stores the row's position in the heap, and it also needs one extra read of the heap.

A PK lookup gets the whole row in one go because of the [clustered index](chunk://clustered-index). A secondary index lookup still has to take the PK back to the clustered index for a second lookup. To skip that step, you need the covering index below.

## Practical details

**Covering index**: not a special index type, but a state. When the columns a query needs all happen to be in the index, that index is covering for that query. No need to go back to the table for another read. Details (including column order in a composite index) are in [Covering Index](chunk://covering-index).
