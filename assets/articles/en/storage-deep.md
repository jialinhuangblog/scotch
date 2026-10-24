---
title: "The query went from 2ms to 1.2 seconds just because the data grew. Index, partition and sharding all exist to help each query find its rows"
slug: storage-deep
date: 2026-03-14
updated: 2026-10-17
revisions: 5
chapter: "storage"
tags: [database, index, b-tree, partition, sharding, innodb, storage]
related: [the-log, replication-cap, storage-internal, scaling-first-move]
---

# The query went from 2ms to 1.2 seconds just because the data grew. Index, partition and sharding all exist to help each query find its rows

The product has been live for three months. Users went from 100 to 100,000. There is an orders table. Three months ago a query took 2ms; now it takes 1.2 seconds. No code changed, no schema changed. The data just went from 10,000 rows to 8 million.

The DBA says "just add an [index](chunk://index-basics)". But what is an index? Where does it go? Why does adding one sometimes make things slower?

---

## A world without indexes

A users table with 1 million rows. Run `SELECT * FROM users WHERE email = 'bob@example.com'`.

The DB has no idea where bob is. It can only start at the first row and compare the email column one row at a time. This is a full table scan. 1 million rows means 1 million comparisons.

Data lives on disk, and each read is one page (usually 16KB). A page holds tens to hundreds of rows. A full table scan reads every page of the whole table.

Query time grows in proportion to the data. Double the data, double the query time. O(n).

---

## B-Tree: find data through a table of contents

[B-Tree](chunk://b-tree) is the default index structure in most RDBMS. PostgreSQL and MySQL (InnoDB) both use it.

Picture a dictionary. Looking up "banana", you do not turn every page from first to last. You check the table of contents first: words starting with B begin on page 50. Open near page 50, then narrow down. Three steps.

A B-Tree is built the same way:

```text
                         [M]
                        /   \
                 [D, H]       [R, W]
                / |  \        / |  \
           [A-C][D-G][H-L] [M-Q][R-V][W-Z]
```

Each node is one page on disk. Walk down from the root, and each level down rules out most of the impossible range. 1 million rows take only 3-4 levels to locate. O(log n).

### What a leaf node holds

**[Clustered index](chunk://clustered-index) (the InnoDB Primary Key):** the leaf node holds the whole row.

```text
leaf page: | PK=1, name="Alice", email="a@x.com" |
           | PK=2, name="Bob",   email="b@x.com" |
           | PK=3, name="Carol", email="c@x.com" |
```

`WHERE id = 2` walks the B-Tree to the leaf, and the data is right there. One lookup.

A clustered index is not unique to MySQL, but each product behaves differently. In InnoDB the PK is always the clustered index; there is no choice. In SQL Server the PK is clustered by default but can be moved to another column. PostgreSQL has no clustered index. Data lives in the heap, every index (the PK included) is secondary, and after an index lookup the query usually has to go back to the heap for the row. The exception is the index-only scan: when every column needed is in the index, and the visibility map marks that page as all visible, there is no heap visit [SRC: postgresql.org/docs/current/indexes-index-only-scans.html].

**Secondary index (for example, an index on email):** the leaf node holds the PK value.

```text
leaf page: | email="a@x.com" → PK=1 |
           | email="b@x.com" → PK=2 |
```

`WHERE email = 'b@x.com'` walks the email index first to find PK=2, then uses PK=2 for one more lookup in the clustered index to get the whole row. Two B-Tree lookups. This is called a bookmark lookup. A PostgreSQL index stores the row's physical position in the heap (the TID: page number plus slot number within the page). Going back to the heap means reading that page directly, with no second B-Tree walk [SRC: postgresql.org/docs/current/indexam.html].

### Leaves are linked

The leaf nodes of a B-Tree are chained together with pointers. That makes range queries practical:

```sql
WHERE age > 25 AND age < 30
```

Walk to the leaf for age=25, then follow the chain to the right until age=30 and stop. No need to go back to the root and search again.

### Other index structures

B-Tree is not the only option. Different query patterns need different data structures:

**Hash index** feeds the key into a hash function and computes the position directly. O(1), faster than a B-Tree. But hash values have no order, so range queries are impossible (`WHERE age > 25` cannot use a hash). Exact match only.

**Bitmap index** builds one bit array per possible value. Say the status column has three values, over 1 million rows:

```text
status="pending":    1 0 0 1 0 1 0 0 ...  (1 million bits)
status="shipped":    0 1 0 0 1 0 0 1 ...
status="delivered":  0 0 1 0 0 0 1 0 ...
```

`WHERE status = 'pending'` reads that one bit array and scans no rows at all. Combined conditions use bitwise operations: `WHERE status = 'pending' AND region = 'asia'` is an AND of two bitmaps. Fits columns with few values (enum types). With too many values, each value needs its own full bitmap, and the space gets too large.

**Full-text index** uses an [inverted index](chunk://search-inverted-index). It splits the text into words and records which rows each word appears in:

```text
"apple"  → row 1, 3, 7
"banana" → row 2, 3, 9
```

`MATCH(content) AGAINST('apple banana')` fetches the row lists for both words and takes the union or intersection. No need to open every document and compare. `LIKE '%apple%'` scans row by row; the inverted index is a direct table lookup. This structure is the core of Elasticsearch, with tokenizers, relevance scoring and distributed queries layered on top.

### The cost of an index

Every extra index means every INSERT and UPDATE writes one more index structure. Five indexes means six writes (one for data plus five for indexes).

---

## Storage Engine: why InnoDB won

MySQL's storage engine is pluggable. Inside one MySQL, different tables can use different engines. Other DBs basically do not offer this. In the early days that flexibility came with a choice to make:

| | InnoDB | MyISAM |
|---|---|---|
| Locking | Row level | Table level |
| Transaction | ACID | None |
| Crash recovery | Automatic (WAL) | Manual repair |
| Index | Clustered (data in the leaf) | Not clustered (data stored separately) |

MyISAM locks the whole table on write. One writer, and every read and write waits. 100 requests at once turn into a queue.

InnoDB locks at the row level. 100 people writing different rows at the same time do not interfere with each other.

MyISAM has no crash recovery. If the server dies, the table may be corrupted, and you run `myisamchk` to repair it by hand. InnoDB uses a [WAL](chunk://wal) (write-ahead log). After a crash, a restart recovers from the redo log automatically.

MyISAM lost this badly, so why was it the default for fifteen years?

The reason is the market of 1995. MySQL's target users were PHP websites, message boards, CMS: mostly reads, few writes, if it crashes just restart it, fast and simple. Those users did not need transactions. MyISAM was not unable to do transactions; it left them out on purpose, in exchange for faster reads and simpler deployment. The transaction part MySQL left to others through the pluggable interface: InnoDB was an engine made by a third party, the Finnish company Innobase, and was merged into MySQL 3.23 only in 2001. Later, web applications started taking money. E-commerce and payments appeared, and "if it dies just rerun it" no longer held. MySQL 5.5 (2010) switched the default engine to InnoDB, and today there is almost no reason to use MyISAM.

Oracle and SQL Server took the other road from day one. They sold to banks, ERP, order systems. The customers' bottom line: money must never be counted wrong, and a dead machine must never corrupt data. So the whole DB was designed around transactions, row locks and crash recovery from the start. The engine and the DB are one piece; it cannot be split, and never needed to be. PostgreSQL came out of academia, and transactions are likewise built into its core.

The reason InnoDB won breaks down into four features: MVCC, ACID, row lock, crash recovery. Commercial OLTP customers needed all four from day one, so the other vendors built them in from the start and never had a "choose an engine" question. The market MySQL grew from did not need them, and InnoDB filled them in afterwards:

| DB | Built-in engine | Which InnoDB features it matches |
|---|---|---|
| MySQL (InnoDB) | clustered B+Tree + redo/undo log | the baseline: MVCC, ACID, row lock, crash recovery |
| PostgreSQL | heap + WAL | MVCC, ACID, row lock, crash recovery |
| SQLite | B-Tree (rollback journal by default, WAL has to be turned on by hand) | ACID, crash recovery. One lock for the whole DB, no row lock |
| Oracle | heap + redo/undo log | MVCC (old versions kept in undo), ACID, row lock, crash recovery |
| SQL Server | heap or clustered index + transaction log | ACID, row lock, crash recovery. MVCC needs snapshot isolation turned on by hand, old versions stored in tempdb |

Strictly speaking, PostgreSQL 12 and later have a table access method interface that can swap the engine (heap by default), and SQL Server has In-Memory OLTP as a separate engine. But in practice almost nobody swaps, so "the engine and the DB cannot be split" mostly holds.

After InnoDB caught up, a few places are still done better than elsewhere. The clustered index saves the PK lookup one hop; PostgreSQL has no such option. Old versions are kept together in the undo log and cleared when no longer needed, unlike PostgreSQL, which leaves dead versions in place in the heap until vacuum (PostgreSQL's background process for clearing dead versions) reclaims them afterwards. So the features are even, and the difference comes down to the clustered index and where old versions live.

---

## ACID: what choosing InnoDB buys you

"Supports transactions" by itself guarantees nothing. Being able to write BEGIN + COMMIT does not mean the data survives when something goes wrong. Choosing InnoDB over MyISAM buys the four [ACID](chunk://acid) guarantees:

- **Atomicity**: a transaction either runs completely or not at all. Money deducted but no order created cannot happen.
- **Consistency**: data always follows the defined rules; the DB enforces foreign keys and unique constraints.
- **Isolation**: two transactions running at the same time cannot see data the other is still writing. InnoDB uses [MVCC](chunk://mvcc) so reads and writes never wait on each other, and [isolation levels](chunk://isolation-levels) set how strict the isolation is.
- **Durability**: once committed, data survives even a power cut. InnoDB guarantees this with the [WAL](chunk://wal) (write the log before the data).

How these four letters actually run underneath (undo log, version chain, redo log replay, how WAL and MVCC divide the work) is the topic of another article: [UPDATE one row: what InnoDB and Cassandra each do](article://storage-internal).

---

## Partition: one table is too large, so split it inside the same DB

Index solved "queries are slow". But once a table has 500 million rows, even with an index, the B-Tree has more levels, the cache cannot hold it, and every query touches disk.

Partition splits one table into several pieces. Logically it is still one table, and the DB manages the pieces internally.

### Horizontal partition (split by row)

```sql
CREATE TABLE sales (
    id SERIAL,
    sale_date DATE NOT NULL,
    amount DECIMAL(10,2)
) PARTITION BY RANGE (sale_date);

CREATE TABLE sales_2023 PARTITION OF sales
    FOR VALUES FROM ('2023-01-01') TO ('2024-01-01');

CREATE TABLE sales_2024 PARTITION OF sales
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
```

For `WHERE sale_date = '2024-02-15'`, the DB knows to scan only sales_2024 and never touches sales_2023. This is called partition pruning. 500 million rows split into 5 pieces, 100 million each, and the scan volume drops by 80% outright.

On INSERT the DB routes to the right partition automatically. The application code does not change.

(A vertical partition, split by column, in Postgres/MySQL is really just splitting into several tables yourself and JOINing them. It is not a native feature and is a different thing from the row split here. Details in [db-partition](chunk://db-partition).)

### The limits of partition

A partition lives inside one DB. Disk, CPU and memory are capped by that one machine. 500 million rows split into 5 partitions is still 100 million rows per partition. What if one machine cannot handle even 100 million?

---

## Sharding: split across machines

Partition is managed by the DB; the application does not need to know. With sharding, the application itself decides which machine the data goes to.

```text
userId % 3 = 0 → Shard A (machine 1)
userId % 3 = 1 → Shard B (machine 2)
userId % 3 = 2 → Shard C (machine 3)
```

Each machine holds one third of the data. The CPU, memory and disk of the three machines are independent. Write volume is spread out too.

### What the routing logic looks like

The most direct cost of sharding is that the application has to decide for every query which DB it goes to. This routing logic shows up at every place in the codebase that reads data:

```typescript
const shardConfigs = [
  { id: 0, host: 'db-shard-0.internal', port: 5432 },
  { id: 1, host: 'db-shard-1.internal', port: 5432 },
  { id: 2, host: 'db-shard-2.internal', port: 5432 },
];

function getShardForUser(userId: number) {
  return shardConfigs[userId % shardConfigs.length];
}

// every query computes the shard first
async function getUser(userId: number) {
  const shard = getShardForUser(userId);
  const db = await connectTo(shard);
  return db.query('SELECT * FROM users WHERE id = $1', [userId]);
}

// a query across shards merges the results itself
async function getUsers(userIds: number[]) {
  const grouped = new Map<number, number[]>();
  for (const id of userIds) {
    const shardId = id % shardConfigs.length;
    if (!grouped.has(shardId)) grouped.set(shardId, []);
    grouped.get(shardId)!.push(id);
  }

  const results = await Promise.all(
    [...grouped.entries()].map(([shardId, ids]) => {
      const db = connectTo(shardConfigs[shardId]);
      return db.query('SELECT * FROM users WHERE id = ANY($1)', [ids]);
    })
  );

  return results.flat();
}
```

Without sharding, `getUser` is one line of SQL. With sharding, every query computes its shard first, queries across shards have to be split and merged by hand, and every data access layer has to carry this logic.

### Other costs

**JOIN across shards.** `SELECT * FROM orders JOIN users ON orders.user_id = users.id`: if orders and users use different shard keys, the JOIN spans every shard and the merge happens in the application layer.

**Transactions across shards.** Deduct money from user A (Shard 0) and add it to user B's account (Shard 1). One transaction spans two machines and needs a distributed transaction, for example 2PC (two-phase commit): ask every machine whether it can commit first, and commit for real only when all of them say yes. Complexity goes up a lot.

**Resharding.** Three machines are not enough and a fourth is added. `userId % 3` becomes `userId % 4`, and a lot of data has to move. The service cannot stop during the migration. Consistent hashing reduces how much moves but cannot eliminate it.

### The order

These measures have a clear order:

```text
queries got slow
  ↓ add an index (smallest cost, a schema change is enough)
still slow
  ↓ partition (split inside the same DB, no application change)
one DB cannot handle it
  ↓ shard (largest cost, the application has to change its routing logic)
```

Each step costs an order of magnitude more than the one before. An index is one line of DDL. Partition needs a split strategy. Sharding needs application architecture changes, handling of queries across shards, and a plan for resharding.

---

## Back to that orders table

10,000 rows three months ago, 8 million now, and the query went from 2ms to 1.2 seconds. Below is an illustrative timeline. The numbers are examples; the trigger signals are what the decision rests on.

The signal for the first step is query latency exceeding the target. A composite index on `user_id` and `created_at` turns the scan into an index lookup, and queries are back to single-digit ms.

Six months later the data reaches tens of millions of rows. This is when partition comes up, usually because **a single table is getting hard to maintain**: adding a column holds a lock for a long time, rebuilding an index runs for hours, vacuum / analyze take longer, and hot and cold data mixed together hurts the cache hit rate. After a range partition on `created_at`, one per month, most queries touch only the last few months, and old data can be archived along the way.

Two years later the data is heading toward billions of rows. But the signal for sharding is not the row count (a single DB holding billions of rows is common). It is **a single machine's write throughput, IO or disk capacity hitting its limit**: writes per second near the disk bandwidth, CPU saturated for long stretches, connection count at the limit. Hash sharding on `user_id` spreads the data over several machines, each handling only part of the workload. The cost: the application adds a shard router, and reporting queries across shards become asynchronous batch jobs.

---

## When writes far outnumber reads, or machines will die

**[LSM-Tree](chunk://lsm-tree)** is the other option besides B-Tree. B-Tree reads fast and writes slow; LSM-Tree writes fast and reads slow. Cassandra, RocksDB and LevelDB all use LSM-Tree. It fits workloads where writes far outnumber reads.

**[Replication](chunk://replication)** solves a different problem: what happens to the data when a machine dies. Sharding spreads the load; replication provides redundancy. The two are usually used together.

**[CAP theorem](chunk://cap)** limits the design space of a distributed DB. After sharding, the DB is a distributed system, and the trade between consistency and availability cannot be avoided.
