---
title: "CAP"
slug: cap
brief: "CAP is not pick two of three. When the network splits, you pick between consistency and availability."
date: 2026-03-15
updated: 2026-10-18
revisions: 7
article: replication-cap
---

# CAP (Consistency, Availability, Partition Tolerance)

> Distributed systems theory, not limited to databases. Any multi-node system (DB, message queue, cache cluster) is subject to it.

Once the network splits and nodes cannot reach each other, a distributed system has to pick between consistency and availability.

## The three letters

- **C (Consistency)**: every read returns the latest write. All nodes see the same data at the same time.
- **A (Availability)**: every request gets a response (not an error), with no promise that it is the latest value.
- **P (Partition Tolerance)**: the system keeps running when the network splits and nodes cannot reach each other.

## The choice is not among three

"Pick two of three" is misleading. P cannot be given up, because a distributed system will run into a network split sooner or later. The real choice is: **when a partition happens, C or A?**

Without a partition, C and A can both hold.

## CP and AP

During a partition, check two things: does the minority side accept writes, and do reads return the latest value. The same system lands somewhere else once you change how it reads, so each one below names its setting.

**CP**: the minority side refuses writes, and every read returns the latest value. A node that cannot give the latest value returns an error (gives up A).

- etcd (default reads): the minority side becomes unavailable after a partition, and default reads are linearizable
- MongoDB (readPreference primary): only the primary can complete majority writes, and reads fail when there is no primary
- ZooKeeper (default): a server cut off from the majority stops answering clients, so both reads and writes stop
- CockroachDB: a write needs a majority of replicas, and the minority node holding the lease answers reads only until the lease expires, while nobody else can write

**AP**: both sides keep accepting writes during a partition and merge later, so the two sides may return different values.

- Cassandra (writes at ONE): a write succeeds as soon as one replica responds

**Neither**: the minority side refuses writes but still answers reads, which may be stale. Writes have no A, reads have no C. Each system below has one leader that takes writes, while followers answer reads from their own copy.

- etcd (serializable reads), ZooKeeper (read-only mode plus local sessions), MongoDB (readPreference secondary), Postgres (reads allowed on a standby)
- DNS: a record changes only at its source, every other DNS server answers on its own, and may return a stale IP until the TTL expires

## Is RDB CP and NoSQL AP?

Half of it does not hold. A single-node Postgres has no second node to be partitioned from, so it is outside CAP entirely. Once there is a replica, whether it picks C or A depends on how replication is designed. NoSQL has systems in every category. RDBs rarely land on AP, because unique keys, foreign keys and transactions all require writes to fall into one order: if both sides of a partition each accept a signup with the same email, the unique key cannot survive the merge. So RDB replication usually lets only one node accept writes:

| During a partition | NoSQL | RDB |
|---|---|---|
| CP | etcd (default reads), ZooKeeper (default), MongoDB (readPreference primary), DynamoDB (strongly consistent reads: single Region, global tables MRSC) | Postgres (sync replication, all reads and writes to the primary), CockroachDB |
| Neither | etcd (serializable reads), ZooKeeper (read-only mode plus local sessions), MongoDB (readPreference secondary), DynamoDB (eventually consistent reads) | Postgres (reads allowed on a standby, sync or async alike) |
| AP | Cassandra (writes at ONE), DynamoDB global tables (MREC) | rare |

When the network is cut, a Postgres primary with sync replication gets no reply from the standby, so writes hang and never return. If every read and write goes to the primary, the standby's side gets nothing, which is CP. If reads are allowed on the standby, it answers from its own copy, which may be stale, so it is neither. `synchronous_commit` set to `on` or `remote_apply` only matters in normal operation: `on` waits for the standby to flush the record to disk, so a read on the standby right after a write may still be stale, while `remote_apply` waits until the standby has applied it. Switching to async replication does not make it AP either: failover tools such as Patroni demote the primary to read-only when it cannot update the leader lock, so during a partition only one side accepts writes. What async gives up is the moment of failover, when the last few writes on the primary that had not been replicated are lost.

DynamoDB shares little beyond the name with the 2007 Dynamo paper. It splits data into many pieces, each called a partition (a split of the data, not a network partition). Each partition elects a leader with Multi-Paxos and writes go only to the leader, so in a single Region the replicas cut off from the leader cannot accept writes during a partition. Strongly consistent reads also go only to the leader, so with that kind of read it is CP. With eventually consistent reads, those replicas can still answer, but possibly with stale values, so C is lost too and it fits neither CP nor AP. Cross-Region global tables default to MREC: every Region accepts writes and conflicts are merged with last writer wins, which is AP. MRSC mode waits for another Region before returning, which is CP. Cassandra with QUORUM reads and writes, per the official docs, makes the write visible to the read, which moves toward C, at the cost that the minority side can no longer write either. MongoDB's reads are covered in the next section.

## MongoDB's CAP

A common interview question: "Is MongoDB CP or AP?"

By default, only the primary of a MongoDB replica set accepts writes. After a partition, the primary on the minority side steps down and a new primary is elected on the majority side. The minority side cannot write for a while. It chose C.

But MongoDB allows reads from secondaries. The driver's `readPreference` setting controls this:

```
readPreference: "primary"    → read primary only → CP (consistent, but no reads if the primary is down)
readPreference: "secondary"  → may read secondaries → neither (reads never stop, but may be stale; writes still go only to the primary)
```

It can be set in the connection string, the driver config, or `mongosh`. So the same MongoDB replica set is CP with `readPreference` set to `primary`. Setting it to `secondary` does not make it AP, because writes still go only to the primary and the minority side still cannot write; the reading side just gives up C as well. The official docs say every mode except `primary` "may return stale data".

## PACELC: the half CAP leaves out

CAP only answers "what happens during a partition". But partitions are rare. What about normal time, with no partition? PACELC fills in that half. Read it as the acronym spells it:

```text
if P (partitioned)       → A or C
else (normal, no split)  → L or C
```

- During a partition (PAC): pick A or C. This is the original CAP.
- Normal time (ELC): pick L (latency) or C (consistency).

Why is there a choice in normal time too? Because strong consistency has its own cost, unrelated to partitions. To guarantee every node sees the same data, a write has to wait for replicas to confirm before replying, and that wait is latency. Skip the wait with async replication and reads from replicas, and it is faster, but a read may be stale. So even with a healthy network, strong consistency and low latency trade off on every read and write.

## A system gets two answers

To describe a system, state what it picks during a partition and what it picks in normal time:

| System | Partitioned | Normal | Leaning |
|---|---|---|---|
| Cassandra (writes at ONE) | A | L | PA/EL: fast and available |
| RDB with sync replication, ledgers | C | C | PC/EC: correct |

A partition may happen a few times a year, but "read from a replica for lower latency" is chosen on every read. CAP does not cover that part.
