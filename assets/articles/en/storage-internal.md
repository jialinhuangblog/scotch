---
title: "UPDATE one row: what InnoDB and Cassandra each do"
slug: storage-internal
date: 2026-03-16
updated: 2026-10-17
revisions: 1
subtitle: "The same write takes a completely different road in InnoDB and in Cassandra."
chapter: "storage"
tags: [innodb, b-tree, wal, mvcc, lsm-tree, cassandra, storage-engine]
related: [storage-deep, replication-cap, compaction-merge]
---

# UPDATE one row: what InnoDB and Cassandra each do

`UPDATE users SET name='Carol' WHERE id=1`

In InnoDB (a B+ Tree engine) and in Cassandra (an [LSM Tree](chunk://lsm-tree) engine), this one operation takes a completely different road from the moment the Client sends the query to the moment the data is written to disk.

---

## The RDB road: InnoDB (MySQL)

### Step 1: find the page

InnoDB stores data in the leaf pages of a [B+ Tree](chunk://b-tree). Each page is 16KB and holds a few dozen to a few hundred rows.

```text
B+ Tree:
         [50, 100]          ← internal page (keys only)
        /     |     \
[1..49 rows] [50..99 rows] [100..150 rows]  ← leaf page (key + data)
```

`WHERE id=1` starts at the root and walks 3-4 levels down to the leaf page.

### Step 2: Buffer Pool

InnoDB does not read the page from disk every time. In memory there is a page cache called the **Buffer Pool** (128MB by default, usually a few GB in production).

```text
Is the page holding id=1 in the Buffer Pool?
  → yes: use it directly (hit)
  → no: read it from disk into the Buffer Pool (miss)
```

In most OLTP workloads, the pages for frequently used data are almost all in the Buffer Pool, and the hit rate is usually above 99%.

### Step 3: change the page in memory

Find the row with id=1 and change name from 'Bob' to 'Carol' inside the Buffer Pool.

The page is now changed but not yet written back to disk. This is a **dirty page**.

### Step 4: write the WAL (redo log)

After changing the page, write the record "page X, offset Y, set to Carol" into the [WAL](chunk://wal).

```text
WAL record:
  LSN: 10042               ← Log Sequence Number, increases globally
  Page: 5
  Offset: 320
  After: "Carol"
```

The redo log only records the value after the change. The old value 'Bob' goes to the undo log, covered in the next step.

The WAL is append-only, a sequential write, and fast. Once the WAL is written and fsynced to disk, reply "OK, committed" to the Client.

At this point the dirty page is still in the Buffer Pool, not yet written back to the B+ Tree on disk. That is fine. The WAL is already on disk, so even after a power cut the data can be recovered from the WAL.

### Step 5: [MVCC](chunk://mvcc), where the old version goes

An UPDATE does not overwrite in place. Before the change, InnoDB copies the old value ('Bob') to the undo log.

```text
B+ Tree leaf page:
  id=1, name="Carol" (latest version)
          ↓ pointer
undo log:
  name="Bob" (old version)
```

If another transaction is still reading id=1 at this moment (one that started before this UPDATE), it follows the pointer into the undo log and finds 'Bob'. What it reads is the snapshot from when its own transaction started.

### Step 6: Checkpoint, dirty pages written back to disk

A background checkpoint process periodically writes dirty pages from the Buffer Pool back to the B+ Tree on disk. Once written, the matching WAL records can be discarded.

```text
Full flow:

Client: UPDATE users SET name='Carol' WHERE id=1
  │
  ▼
Buffer Pool: find page → change page (dirty) → old value moves to undo log
  │
  ▼
WAL: write redo record → fsync → reply Client OK
  │
  ▼
Background Checkpoint: dirty page written back to B+ Tree → WAL truncated
```

### pseudocode

```javascript
function update(id, new_name):
    // Step 1-2: find the page
    page = buffer_pool.get(id)
    if page == null:
        page = disk.read(btree.find_leaf(id))
        buffer_pool.put(page)

    row = page.find_row(id)

    // Step 5: MVCC, old value moves to undo log
    undo_log.append(row.clone())
    row.roll_pointer = undo_log.last()

    // Step 3: change the page
    row.name = new_name
    row.trx_id = current_transaction.id
    page.mark_dirty()

    // Step 4: write WAL
    wal.append({page: page.id, offset: row.offset, after: new_name})
    wal.fsync()

    return OK
```

---

## The NoSQL road: Cassandra (LSM Tree)

The same operation: `UPDATE users SET name='Carol' WHERE id=1`

### Step 1: write the WAL (Commit Log)

Like InnoDB, Cassandra writes the log first. It calls it the commit log. The difference is when it fsyncs. With the default `commitlog_sync: periodic`, Cassandra replies OK as soon as the write is in the commit log and fsyncs only every 10 seconds. So if a single node loses power, writes it already answered OK for in the last 10 seconds may be lost. To wait for fsync before replying, as InnoDB does, switch to `batch` or `group` mode [SRC: github.com/apache/cassandra/blob/cassandra-5.0/conf/cassandra.yaml].

### Step 2: write into the Memtable

The Memtable is a sorted structure in memory. Insert `{id: 1, name: "Carol", timestamp: T3}` straight into it.

```text
Memtable (memory, sorted by key):
  id=1: name="Carol", ts=T3    ← just written
  id=5: name="Eve",   ts=T1
  id=9: name="Ivan",  ts=T2
```

No page to find, no position to find. A direct insert into the memory structure is an O(log N) operation, and once it is done, reply OK to the Client.

This road does not go through a Buffer Pool, and there is no dirty page to write back.

### Step 3: no MVCC

Cassandra does not need MVCC, because it has no transactions spanning multiple rows and no isolation levels, only lightweight transactions on a single partition. Every write carries a timestamp, and a read takes the one with the largest timestamp as the latest value.

```text
History of id=1:
  ts=T1: name="Alice"
  ts=T2: name="Bob"
  ts=T3: name="Carol"    ← latest
```

If two clients write id=1 at the same time, **last-write-wins**: the larger timestamp overwrites the smaller one. No lock, no version chain.

### Step 4: flush into an SSTable

When the Memtable reaches its configured size limit, the whole thing is written to disk in sorted order as one SSTable file. A sequential write, with no position to find.

```text
Memtable full → flush
  ↓
SSTable-001.db (disk, immutable):
  id=1: name="Carol", ts=T3
  id=5: name="Eve",   ts=T1
  id=9: name="Ivan",  ts=T2
```

Once written, an SSTable is never modified. Older writes may sit in earlier SSTables, and compaction merges them later.

### Step 5: Compaction

SSTables keep piling up. Compaction merges several SSTables and discards old versions of the same key.

```text
SSTable-001: id=1 name="Alice" ts=T1
SSTable-002: id=1 name="Carol" ts=T3
  ↓ compaction
SSTable-003: id=1 name="Carol" ts=T3    ← only the latest is kept
```

### pseudocode

```javascript
function update(id, new_name):
    timestamp = now()

    // Step 1: write commit log
    commit_log.append({id: id, name: new_name, ts: timestamp})
    // default commitlog_sync: periodic, fsync every 10 s; only batch and group mode fsync before the reply

    // Step 2: write memtable
    memtable.put(id, {name: new_name, ts: timestamp})

    // Step 3: no MVCC, no undo log, no page to find

    return OK

// background: memtable full → flush
function flush():
    sorted_data = memtable.to_sorted_array()
    sstable = disk.write_sequential(sorted_data)
    commit_log.truncate()
    memtable.clear()
```

---

## InnoDB and Cassandra side by side

| Step | InnoDB (B+ Tree) | Cassandra (LSM Tree) |
|---|---|---|
| Find the data's position | walk the B+ Tree to the leaf page | nothing to find, insert straight into memory |
| Change the data | change the page in the Buffer Pool | write into the Memtable |
| Old value | moved to the undo log (MVCC) | untouched, the timestamps decide |
| Write the log | WAL (redo log) | Commit Log |
| Reply to Client | after WAL fsync | after the Commit Log append (fsync every 10 s by default; batch and group mode wait for it) |
| Data reaches disk | background checkpoint writes back to B+ Tree pages | background flush into an SSTable |
| Write pattern | random write (find the page, then change it) | sequential write (whole batch written in sorted order) |
| Conflict handling | Transaction + MVCC | Last-write-wins (timestamp) |

---

## Why both roads write the log first

InnoDB and Cassandra differ this much, yet the first step on both is writing the log, because the data first lives in memory (the Buffer Pool or the Memtable), and memory is gone after a power cut. The log is the insurance on disk. After a power cut, recover from the log. Only the part already fsynced can be recovered, though, so Cassandra's default periodic mode may lose the last 10 seconds.

After the log is written, what the two do in the background differs:

```text
InnoDB:     WAL → background writes dirty pages back to the B+ Tree (random write)
Cassandra:  Commit Log → background flushes the memtable into an SSTable (sequential write)
```

In the end InnoDB maintains one sorted B+ Tree, while Cassandra keeps producing new SSTables and merges them periodically.

## The random write did not disappear

InnoDB's checkpoint is still a random write in the end (writing dirty pages back to their various positions in the B+ Tree). What the WAL does is move the random write off the path the client waits on, into the background, to be done at its own pace.

```text
B+ Tree without WAL:
  Client writes → random write right away → reply Client
  (Client waits on the random write, slow)

InnoDB + WAL:
  Client writes → WAL sequential write → reply Client OK
                    ↓ (background, Client does not wait)
                 checkpoint random write
  (Client only waits on the sequential write, fast)

LSM Tree:
  Client writes → Commit Log sequential write → reply Client OK
                    ↓ (background)
                 flush sequential write → compaction sequential write
  (sequential write from start to finish)
```

InnoDB uses the WAL to postpone the random write into the background. The LSM Tree goes further: it does no random write even in the background. The cost is that a read has to scan several SSTables, and compaction takes disk space and IO.

This is the RUM trade-off of storage engines: three costs, read (Read), write (Update) and space (Memory), and you can push down at most two. The remaining one gets worse. A B-tree reads fast, and the cost is write amplification, meaning one update actually writes several times the size of the original data to disk. LSM writes fast, and with compression it usually saves space too. Its main cost is on reads, because it scans several SSTables. Like CAP, RUM cannot have all three, but RUM is a continuous, tunable trade-off. The same LSM with a different compaction strategy redistributes the cost between read, write and space. It is not the hard either/or choice of CAP. To really push all three down, you invest more RAM and hardware, which means money, or switch to a better algorithm that lowers all three costs together.
