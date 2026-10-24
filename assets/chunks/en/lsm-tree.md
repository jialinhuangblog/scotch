---
title: "LSM Tree"
slug: lsm-tree
brief: "A storage structure that turns every write into a sequential write. RocksDB, Cassandra, and LevelDB all use it."
date: 2026-03-15
updated: 2026-10-19
revisions: 7
article: compaction-merge
---

# LSM Tree (Log-Structured Merge-Tree)

> A general concept. RocksDB, Cassandra, LevelDB, and ClickHouse use it. MySQL (InnoDB) and PostgreSQL do not; they use a B+ Tree.

## Where B+ Tree writes are weak

| Situation | B+ Tree write | LSM Tree write |
|---|---|---|
| Auto-increment PK, no secondary index | sequential (append to the rightmost leaf) | sequential |
| UUID PK | random | sequential |
| Has a secondary index | random (on the secondary side) | sequential |
| UPDATE an existing row | random | sequential (writes a new version) |

Only with an auto-increment PK and no secondary index is a B+ Tree write sequential, the same as LSM. In practice almost every schema has a secondary index, so that case does not hold. The selling point of LSM is that **no matter how the key pattern changes, the write is always sequential**.

The buffer pool softens part of this. A B+ Tree DB changes the page in RAM first and writes it back to the SSD in batches in the background, so a page changed several times is written back once. But once the write volume exceeds what the buffer pool can hold, the cost of random writes shows up in write latency.

## How an LSM Tree does it

Put everything into memory first; once enough has piled up, write it to disk in one sequential pass.

```text
Client write
  → 1. Write the WAL first (sequential append, used to rebuild the memtable after a crash)
  → 2. Write into the Memtable (a sorted structure in RAM)
  → 3. Memtable full → flush it to disk as one SSTable file
```

**Memtable**: a skip list in RAM, keys in order, gone on power loss, rebuilt from the WAL.

**SSTable** (Sorted String Table): the physical file (`.sst`) produced when the Memtable is flushed to disk, keys in order, immutable.

RAM access is ~100 ns, a single 4 KB random read from SSD ~100 μs, a gap of about 1,000x (how it was measured: [latency-hierarchy](article://latency-hierarchy)). An LSM write only touches RAM plus one sequential append to the WAL, so it is fast. But the WAL is not necessarily on the SSD yet. RocksDB defaults to `WriteOptions.sync = false`. When a write of key=X returns success, X's WAL record has only been handed to the OS with write() and still sits in the page cache, not fsynced to the SSD. If the process crashes now, nothing is lost, because the page cache is still there and the OS writes it out later. If the whole machine loses power, the WAL has no X after the restart. Cassandra's commitlog defaults to periodic mode and fsyncs once every 10 seconds, so a power loss drops at most those 10 seconds. To lose nothing on any write, turn on RocksDB's `sync = true` or Cassandra's batch mode yourself, and every write waits for one more fsync.

<details>
<summary><strong>The full 17 steps: which part is in RAM and which on SSD (expand for details)</strong></summary>

The CPU cache does not appear in this picture. It is hardware acceleration for RAM access, not a separate storage layer.

### Write path

```text
[1] Client sends PUT key=X, value=Y
    where: Network → the DB process's socket buffer [RAM]

[2] DB process parses the request
    where: function local variables [RAM heap/stack]

[3] Write the WAL (write-ahead log)
    where: append to the end of wal.log; in the OS page cache [RAM] until fsync, on [SSD] after it
    action: write(), sequential write. By default no wait for fsync (RocksDB sync=false; Cassandra fsyncs every 10 seconds)
            with per-write fsync turned on (RocksDB sync=true), this step also waits tens of μs to ~1 ms for the disk
    purpose: if the memtable is lost, replay the WAL to rebuild it

[4] Write the Memtable
    where: [RAM] — a skip list in the DB process heap
    action: like map.set(key, value), ~100ns

[5] Reply to Client: write succeeded
    where: [RAM → Network]
```

Once the WAL is fsynced to the SSD, power loss does not lose it; the Memtable is in RAM, so it is fast enough.

### Flush path

```text
[6] Memtable passes the threshold (say 64MB) → freeze it
    action: create a new empty memtable to take the following writes

[7] A background thread flushes the frozen memtable into an SSTable
    from: [RAM] (the frozen memtable)
    to: [SSD] (produces SSTable_001.sst)
    action: walk the skip list (already sorted), sequential write of the whole file

[8] Flush done → the WAL can be cleared
    where: [SSD] truncate wal.log
```

### Read path

```text
[9] Client sends GET key=X
    where: [Network → RAM]

[10] Check the Memtable (newest data)
     where: [RAM], skip list lookup ~100ns
     result: found → return it; not found → continue

[11] Scan SSTables from newest to oldest
     for each SSTable:
       a. Check the Bloom filter [RAM]
          - says "not here" → skip this SSTable, 0 IO
          - says "maybe here" → go on
       b. Check the SSTable's index block
          - may be in [RAM] (block cache) or on [SSD]
       c. Read the matching data block
          - in the block cache [RAM] → fast
          - read from SSD → ~100μs

[12] Return the result
     where: [RAM → Network]
```

### Compaction (background cleanup)

```text
[13] A background thread notices too many SSTables → picks a few to merge

[14] Read the SSTables to be merged
     from: [SSD] (several .sst files)
     to: [RAM] (streamed, not loaded all at once)

[15] Merge: keep only the newest version of each key, drop tombstones
     where: processed in [RAM]

[16] Write out the new SSTable
     from: [RAM] → [SSD], sequential write

[17] Delete the old SSTables
     where: [SSD]
```

### Where each component lives

| Component | Location | Role |
|---|---|---|
| Memtable | **RAM** | Sorted skip list that receives writes |
| WAL | **SSD** (in the page cache before fsync) | Rebuilds the Memtable after a crash, append only |
| SSTable | **SSD** | Persisted immutable files |
| Bloom filter | **RAM** (loaded with the SSTable) | Quickly rules out keys that are definitely absent |
| SSTable index block | **RAM** (block cache) or **SSD** | Locates the data block |
| SSTable data block | **RAM** (block cache) or **SSD** | The actual key-value data |
| Block cache | **RAM** | LRU cache, cuts down SSD reads |

The write path touches only RAM (memtable) and SSD (WAL). SSTables themselves all live on the SSD; reads use the Bloom filter and block cache in RAM to read the SSD fewer times.

</details>

## What about deletes

An SSTable is immutable; you cannot open the file and remove one line. So DELETE does not really delete data. It writes a **tombstone**: "this key has been deleted".

A read that sees the tombstone knows the record no longer exists. The data is only really dropped later, during compaction.

## Reads got slower

Writes got faster, but reads got slower. A record may be in the memtable, in a recent SSTable, or in a very old SSTable. You have to search from newest to oldest, one by one.

A **Bloom filter** speeds this up. Each SSTable carries a bloom filter that can quickly say "this key is definitely not in this SSTable". Skipping the SSTables that cannot have it saves a lot of wasted reads.

## Block Cache: an LRU speedup for reads

An SSTable is made of many **blocks** (4 KB to 64 KB each). When a read pulls a block from the SSD into RAM, LSM puts that block into the **block cache** (LRU), so the next lookup of a nearby key does not read the SSD again. This relies on locality: after reading key=X, the next read is likely a nearby key=Y.

The block cache and the memtable are both in RAM, but their roles differ:

| | Memtable | Block Cache |
|---|---|---|
| Contents | Newly written data | Copies read from SSTables, recently used |
| Source of truth | Yes (before flush) | No (can be read from the SSTable again) |
| When full | Flush to an SSTable | LRU eviction |

The block cache is an optimization inside the DB engine (RocksDB manages it automatically), a different layer from an application-level Redis. Redis holds frequently read data shared across servers; the block cache holds frequently read blocks inside a single DB instance.

## Compaction: tidying the disk

As SSTables pile up, reads get slower (more files to scan). [Compaction](chunk://compaction) merges several SSTables into one and drops old versions and tombstones.

Like tidying a desk. Sticky notes are scattered everywhere, so every so often you merge them into one notebook and throw out the expired ones.

The merge is a k-way merge. Each SSTable is already sorted internally; take the first entry of each into a min heap, pop the smallest, write it out, and pull the next entry from that file. Time is O(N log k), and the algorithm itself holds only k entries in memory.

Ordinary OLTP (MySQL, PostgreSQL) uses a B+ Tree; write-heavy workloads (RocksDB, Cassandra) use LSM.
