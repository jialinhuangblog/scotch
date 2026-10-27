---
title: "Isolation Levels"
slug: isolation-levels
brief: "Read committed, repeatable read, serializable. The higher the level, the more anomalies it prevents and the less concurrency you get."
date: 2026-06-12
updated: 2026-10-18
revisions: 3
article: storage-deep
---

# Isolation Levels

> Two transactions run at the same time. How far should they be isolated from each other? Cleaner isolation is safer, but also slower.

## What you read with no isolation

Walk through it with one account. Account A holds 1000. T1 is a transfer, T2 is a reconciliation report, and both start at the same time.

```text
T1: BEGIN                                   T2: BEGIN
T1: UPDATE A balance = 1000 - 300
                                            T2: SELECT A balance   → 700? or 1000?
T1: ROLLBACK, transfer failed, back to 1000
                                            T2: SELECT A balance   → 1000
```

If T2's first read returns 700, it has read a change T1 has not committed. That is a dirty read. T1 rolls back afterwards, so 700 never really existed, yet the report counted it.

Even with dirty reads blocked, T2's two reads of the same row can still differ. Change the script so T1 commits normally: T2 reads 1000 the first time and 700 the second. The same row read twice inside one transaction gives two values. That is a non-repeatable read. The first half of the report used 1000, the second half used 700, and the two halves do not add up.

The third kind is about ranges. T2 runs `SELECT count(*) FROM accounts WHERE balance > 500` and gets 10 rows. In between, T1 opens a new account with 800 and commits. T2 runs the query again and gets 11. None of the original rows changed, but the range query gained a row. That is a phantom read.

## Four levels, each step down prevents more

| Level | Prevents | Still happens |
|---|---|---|
| **Read Uncommitted** | nothing | even dirty reads |
| **Read Committed** | dirty read | non-repeatable, phantom |
| **Repeatable Read** | dirty + non-repeatable | phantom (by the standard; PostgreSQL does not; MySQL InnoDB does not only while the transaction reads with plain SELECT, see below) |
| **Serializable** | all | none, as if transactions ran one at a time in a queue |

Going down is safer, but also slower. Read committed and repeatable read both use [MVCC](chunk://mvcc) to let T2 read an old version instead of waiting for T1 to release a lock. The difference is that read committed reads the latest committed version at each SELECT, which is why it sees 1000 and then 700, while repeatable read takes a snapshot at T2's first read and reads that snapshot for the rest of the transaction, so T2 sees 1000 both times. The snapshot is not taken at BEGIN. If T2 waits a while after BEGIN before its first SELECT, it reads the 700 that T1 committed in between. PostgreSQL takes it when the first SQL statement after BEGIN runs, MySQL at the first plain SELECT; to take it at BEGIN in MySQL, write `START TRANSACTION WITH CONSISTENT SNAPSHOT`. Serializable has to lock ranges or detect conflicts and rerun, and concurrency drops a lot.

The MySQL exception shows up when you run the phantom script above. Under repeatable read, T2 counts 10 rows, T1 opens a new account with 800 and commits, and T2 counts again and still gets 10. So far it matches PostgreSQL. But if T2 runs `UPDATE accounts SET ... WHERE balance > 500` between the two counts, MySQL's UPDATE does not read the snapshot. It reads the latest committed rows, so T1's new account is updated too. After the update, that row is a version T2 wrote itself, and the second count returns 11. The same script on PostgreSQL updates only the 10 rows in the snapshot, and the second count is still 10. InnoDB's next-key locks lock a range only on reads that take locks, such as UPDATE, DELETE and `SELECT ... FOR UPDATE`. T2's first count is a plain SELECT and takes no lock, so T1's INSERT goes in without waiting.

Like a shared Google Doc: read uncommitted means you can see the characters someone else is typing and has not saved yet; read committed only shows the saved version; repeatable read freezes the screen the first time you look at the content and shows that version the whole time; serializable has everyone take turns editing, with no simultaneous edits allowed.

## Defaults

Postgres defaults to **Read Committed**, MySQL InnoDB to **Repeatable Read**. The default is not the safest setting; it is a compromise between "safe enough" and "fast enough". Raise it by hand when you need stronger consistency.
