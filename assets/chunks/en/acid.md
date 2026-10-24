---
title: "ACID"
slug: acid
brief: "The four guarantees of a transaction. Each letter is implemented in a different way."
date: 2026-03-16
updated: 2026-10-18
revisions: 2
article: storage-deep
---

# ACID (Atomicity, Consistency, Isolation, Durability)

> A general concept. MySQL (InnoDB), PostgreSQL, SQL Server and Oracle all support ACID. Most NoSQL stores (Cassandra, Redis) do not support full ACID. MongoDB 4.0+ supports multi-document transactions.

> Read next: [WAL](chunk://wal) for how D is done, [MVCC](chunk://mvcc) for how I is done, [Isolation Levels](chunk://isolation-levels) for how much I you get.

A transaction means "these operations either all succeed or none of them happen". ACID is the four guarantees a transaction makes. Only RDBs and a few NoSQL stores (MongoDB 4.0+, the DynamoDB transaction API) support full ACID. A transaction needs a single write order, and leaderless designs like Cassandra have no such order, so they cannot provide it.

## A: Atomicity

All operations in a transaction happen, or none do.

Scenario: a transfer. Deduct 100 from A, add 100 to B. If A is deducted and the power fails while writing B, A's money vanishes.

Atomicity guarantees: on a power failure everything rolls back, and A's 100 comes back.

**How is it done?** The undo log (InnoDB, Oracle). Before each operation runs, record "how to restore this". When a rollback is needed, walk the undo log backwards. PostgreSQL has no undo log: a rollback just marks the transaction aborted and leaves the new row versions for VACUUM.

```text
Before the UPDATE, copy the old value into the undo log:

  current data            undo log (how to restore)
  A = 100  ──set to 0──►  remember "A was 100"
                                 ▲
  power cut / error / ROLLBACK ──┘
  → write A back to 100 per the undo log, as if this never happened
```

## C: Consistency

The data always satisfies the defined rules. The DB rejects writes that break them, such as a foreign key pointing at a row that does not exist, or a collision on a unique column.

This C is not the C in CAP:
- **ACID's C**: the data follows the schema rules (constraints, triggers)
- **CAP's C**: every node sees the same data

**How is it done?** Constraints and triggers, that is, the DB's ability to check rules at write time. A relies on the undo log in InnoDB and Oracle, and in PostgreSQL on "mark the transaction aborted, so nobody reads the new versions it wrote". I relies on MVCC, D on the WAL. C has no dedicated mechanism like that.

## I: Isolation

Two transactions run at the same time, and neither sees the other's half-written data.

Scenario: Transaction A is reading the orders table while Transaction B is changing it. Without isolation, A may read data B has changed halfway.

**How is it done?** MVCC (Multi-Version Concurrency Control). An UPDATE does not overwrite the old value; it creates a new version. A keeps seeing the old version while B builds the new one. Reads do not wait for writes, and writes do not wait for reads.

Isolation comes in degrees, controlled by the Isolation Level:

| Level | What you see | Performance |
|---|---|---|
| Read Uncommitted | Other transactions' half-written data | Fastest, most dangerous |
| Read Committed | Only what others have committed | PostgreSQL default |
| Repeatable Read | The same snapshot for the whole transaction | MySQL InnoDB default |
| Serializable | Fully isolated, as if run one after another | Safest, slowest |

## D: Durability

Once committed, the data survives even if the power fails right away.

**How is it done?** The [WAL](chunk://wal) (Write-Ahead Log). At commit, the change is written to the WAL first (sequential write, fsync to disk), then the client gets the reply. The actual change to the B+ Tree page happens later. After a power failure, the DB restarts, reads the WAL and replays it.

## Which letter maps to which mechanism

| Letter | Guarantee | How it is done |
|---|---|---|
| A (Atomicity) | All or nothing | InnoDB, Oracle: undo log (restore in reverse). PostgreSQL: mark the transaction aborted, leave the new versions for VACUUM |
| C (Consistency) | Data follows the rules | Constraints / Triggers |
| I (Isolation) | Transactions do not interfere | MVCC + Isolation Levels |
| D (Durability) | Nothing lost after commit | WAL (write the log before the data) |
