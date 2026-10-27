---
title: "Pessimistic Lock"
slug: pessimistic-lock
brief: "Assume a conflict will happen, and lock the row before doing anything. Everyone else waits in line."
date: 2026-07-31
article: storage-deep
---

# Pessimistic Lock

> Two people rate the same shop at the same time. How do you keep avg_rating from being overwritten? The pessimistic lock's answer: lock first, everyone else waits.

## The problem: write vs write

[MVCC](chunk://mvcc) handles the conflict between reads and writes (readers see an old version and do not wait for the write). But two people **changing** the same row at the same time is something MVCC cannot handle. A row can have only one next version. If both compute from the old value, the later write overwrites the earlier one, and the earlier update is as if it never happened. This is a lost update.

## Row lock: UPDATE takes it automatically

```sql
UPDATE businesses
SET avg_rating = (avg_rating * num_ratings + 5) / (num_ratings + 1),
    num_ratings = num_ratings + 1
WHERE id = 7;
```

When this statement reaches the row with id=7, the DB puts a row lock on it automatically, with no lock syntax written. The second person who wants to change the same row **waits in line**. Only when the first one commits and releases the lock does the second get the lock, re-read the updated value, and compute. Both increments land correctly.

A pessimistic lock **makes the latecomer wait instead of fail**. Locking, queueing, and releasing are all handled by the DB; the code needs no extra logic.

## SELECT ... FOR UPDATE: lock ahead of time

A row lock is taken only when the UPDATE reaches the row. Sometimes you need to "lock at read time, compute, then write", with nobody allowed in between. The classic case is deducting stock:

```sql
BEGIN;
SELECT stock FROM products WHERE id = 7 FOR UPDATE;  -- locked right now
-- application checks whether stock is enough and computes the new value
UPDATE products SET stock = stock - 1 WHERE id = 7;
COMMIT;  -- the lock is released only here
```

Why insist on FOR UPDATE? Say 1 unit is left and two people order at the same time. Without the lock, both SELECTs read stock=1, both decide "still in stock", each deducts to 0, and 2 units are sold. Oversold. With FOR UPDATE, the first person's SELECT locks the row and the second person's SELECT waits in line; once the first commits (stock is now 0), the second reads 0, decides it is out of stock, and rejects the order. Ticket sales are the same thing: lock that seat's row first, and two people cannot get the same seat.

A plain `SELECT` reads the MVCC snapshot; it neither locks nor gets blocked. With `FOR UPDATE`, the SELECT joins the writers' queue.

## The cost

- **The lock is held until COMMIT**: so keep transactions short. Do not call external APIs or run slow operations inside; otherwise the lock stays held and everyone else lines up behind it.
- **Deadlock**: A locks row 7 and waits for row 9, B locks row 9 and waits for row 7. Each waits for the other. Postgres detects this and rolls one of them back. To avoid it, lock rows in the same order everywhere when updating several (for example always by ascending id).

## When to use it

When conflicts are frequent, or when you do not want to write retry logic in the application. The other path is the [optimistic lock](chunk://optimistic-lock): when conflicts are rare, locking up front and waiting is wasted cost. Better to assume no conflict and start over when one does happen.

When the same row is updated thousands of times per second, requests waiting on the row lock keep accumulating, and even a pessimistic lock stops being worth it. Switch to [write-behind](chunk://cache-strategies): accumulate in Redis first and flush to the DB periodically.

## Three mechanisms compared

| Mechanism | Which conflict | Holds a spot? | Who implements it |
|---|---|---|---|
| [MVCC](chunk://mvcc) | read vs write | No, reads an old snapshot | DB, automatic |
| [Pessimistic lock](chunk://pessimistic-lock) | write vs write | Yes, taken up front, others queue | DB, automatic (UPDATE / FOR UPDATE) |
| [Optimistic lock](chunk://optimistic-lock) | write vs write | No, compares version on write back | Application (version + retry) |

MVCC is not on the pessimistic vs optimistic axis; it handles the conflict between reads and writes. Only write vs write conflicts force a choice between the two: when conflicts are frequent, queueing beats endless retrying, so use a pessimistic lock; when conflicts are rare, locking up front is mostly wasted cost, so use an optimistic lock.
