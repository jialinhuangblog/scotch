---
title: "Optimistic Lock"
slug: optimistic-lock
brief: "No lock; assume nobody else is editing. Compare the version on write back, and start over if someone changed the row first."
date: 2026-07-31
updated: 2026-09-01
revisions: 2
article: storage-deep
---

# Optimistic Lock

> Same situation: two people change one row at the same time. A pessimistic lock locks first. An optimistic lock does the opposite: no lock before the work, and only on write back does it check whether someone else changed the row in the meantime.

## Comparing a version column

Add a `version` column to the table. Remember the version at read time, and use it as a condition on write back.

```sql
-- 1. service reads, no lock
SELECT avg_rating, num_ratings, version FROM businesses WHERE id = 7;
-- → 4.0, 10, v42

-- 2. service computes 4.09 and puts the remembered 42 into the WHERE
UPDATE businesses
SET avg_rating = 4.09, num_ratings = 11, version = version + 1
WHERE id = 7 AND version = 42;
-- → the DB only returns an affected rows count

-- 3. service checks whether affected rows is 1 or 0 and decides on its own whether to retry
```

Both statements are a plain SELECT and a plain UPDATE; no DB lock feature is used. The DB only guarantees that a single UPDATE is atomic: no other transaction can get in between the `version = 42` comparison and the write. Remembering 42, computing the new value, checking affected rows, deciding to retry: all of that lives in the service / repository layer.

The affected rows the UPDATE returns:

- **1 row affected**: nobody touched the row in the meantime, version is still 42, the write succeeds, version becomes 43.
- **0 rows affected**: someone changed it first, version is already 43, the `WHERE` matches no row. The DB returns "0 rows affected", which means the value just computed is already stale.

## A retry mechanism you write yourself

The DB only gives the clue (0 rows affected). The retry loop is the application's job. The DB does not retry on its own, because it cannot know whether retrying this logic is safe.

```ts
async function addRating(id: number, stars: number) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await db.one(
      `SELECT avg_rating, num_ratings, version FROM businesses WHERE id = $1`,
      [id],
    );

    const numRatings = cur.num_ratings + 1;
    const avgRating = (cur.avg_rating * cur.num_ratings + stars) / numRatings;

    const { rowCount } = await db.query(
      `UPDATE businesses
          SET avg_rating = $1, num_ratings = $2, version = version + 1
        WHERE id = $3 AND version = $4`,
      [avgRating, numRatings, id, cur.version],
    );

    if (rowCount === 1) return;   // success, done
    // rowCount === 0: someone got in first, go back, re-read and recompute
  }
  throw new Error('too many conflicts');   // attempts used up, return an error and let the caller decide
}
```

Retries need an **upper bound**, or they run forever under heavy conflict. What to do once the bound is used up (return an error, drop into a queue, degrade) is the application's decision. An ORM **detects** the conflict and throws an exception (for example Hibernate's `@Version`), but the retry logic is still yours to write.

## How it differs from MVCC

Both use a "version", but at different layers:

- [MVCC](chunk://mvcc)'s version is a row snapshot the DB maintains internally; the application never sees it. It lets reads proceed without waiting for writes. The `SELECT` above runs without a lock, and a re-read can see values others have already committed, both because of MVCC.
- The optimistic lock's `version` is a column the application adds itself, and the comparison also happens in the application. This layer is what is called an optimistic lock.

You do not have to add a column. The existing `updated_at` can serve as the version number, or you can compare the old values directly (`WHERE avg_rating = 4.0 AND num_ratings = 10`). Either way, the write back verifies that the data is still what was read.

## The frontend counterpart

[Optimistic UI update](chunk://optimistic-update) (turn the heart red on click, roll back on failure) uses the same idea, moved onto the screen. The Version / ETag checks common in APIs are optimistic locking.

## When to use it

When conflicts are rare (99% no conflict, 1% retry is worth it), or when you do not want to hold a row lock (for example when slow operations run before this logic). Under heavy conflict an optimistic lock keeps retrying; a [pessimistic lock](chunk://pessimistic-lock) does better there, since latecomers queue and each one computes only once.

## Three mechanisms compared

| Mechanism | Which conflict | Holds a spot? | Who implements it |
|---|---|---|---|
| [MVCC](chunk://mvcc) | read vs write | No, reads an old snapshot | DB, automatic |
| [Pessimistic lock](chunk://pessimistic-lock) | write vs write | Yes, taken up front, others queue | DB, automatic (UPDATE / FOR UPDATE) |
| [Optimistic lock](chunk://optimistic-lock) | write vs write | No, compares version on write back | Application (version + retry) |

MVCC is not on the pessimistic vs optimistic axis; it handles the conflict between reads and writes. Only write vs write conflicts force a choice between the two: when conflicts are frequent, queueing beats endless retrying, so use a pessimistic lock; when conflicts are rare, locking up front is mostly wasted cost, so use an optimistic lock.
