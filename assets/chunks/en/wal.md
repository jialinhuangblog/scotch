---
title: "WAL"
slug: wal
brief: "Write-ahead log. Write the log before changing data, so the data can be rebuilt from the log after a crash."
date: 2026-03-15
article: storage-deep
---

# WAL (Write-Ahead Log)

> A general concept. At the DB level: InnoDB calls it the redo log, PostgreSQL and SQLite call it the WAL. The same "log first, then change state" idea shows up outside databases too: Kafka log segments, the Raft replicated log.

Write the log first, then change the data page. A crash loses no data.

## The problem

A DB changes one row, so it has to update a leaf page of the B+ Tree. But that page sits at a random position on disk, and random writes are slow. If power fails halfway through, the page is corrupted (partial write).

## The fix

Before changing any data, write "here is the change I am about to make" into an append-only log file. The log is a sequential write, so it is fast. If power fails halfway through the last record, that is fine too. The log carries checksums (PostgreSQL has a CRC-32C per record, InnoDB one per log block), so on restart the DB recognizes the incomplete last record and drops it.

Only after the log is written does the DB reply "OK, committed" to the client. The actual change to the data page can happen later, at its own pace.

Think of a video recorder: before touching the data, it records "here is what I am going to do". Recording is a smooth sequential write (fast), while changing data pages means jumping around the disk (random write, slow). Once recorded, reply to the client; the real page changes happen in the background. After a power cut, play the recording back and finish whatever was not done (redo). No data is lost.

```text
1. Receive UPDATE users SET name='Bob' WHERE id=1
2. Write WAL: "page 42, offset 100, set to Bob"    ← fsync to disk
3. Reply to client: OK
4. (background) write page 42 from the buffer pool back to disk  ← checkpoint
```

## Crash Recovery

After a restart, the DB reads the WAL and re-applies unfinished changes to the data pages. This is redo. Each data page records the last WAL entry applied to it (the LSN, Log Sequence Number), so redo skips entries already applied and replay never applies a change twice.

## Checkpoint

If dirty pages were never written back to disk, the WAL would grow forever, and a restart would have to replay all of it. Too slow.

A checkpoint flushes the dirty pages in the buffer pool to disk, then marks "WAL up to here can be discarded". Recovery only replays the WAL after the checkpoint.

In recorder terms, a checkpoint is when the recorded changes are actually written into the B+ Tree pages. Once that is done, that stretch of tape (WAL) can be erased.

## The InnoDB write path

```text
Client → Buffer Pool (change page) → WAL (fsync) → reply OK
                ↓
         background checkpoint → write back data page
```

The buffer pool is the in-memory page cache. A query checks the buffer pool first and reads from disk only on a miss. Changes also happen in the buffer pool, and the WAL is what makes that crash safe.

## Not only databases

The WAL idea is everywhere. Kafka log segments, the Raft replicated log, etcd, the ext4 journal. The core is the same: write the log, then change the state.
