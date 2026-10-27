---
title: "Compaction"
slug: compaction
brief: "SSTables pile up; periodically merge them into one big file and drop the old versions."
date: 2026-09-01
article: compaction-merge
---

# Compaction

> The background tidying work of an [LSM Tree](chunk://lsm-tree). Cassandra calls it compaction, ClickHouse calls it merge, Lucene also calls it merge.

## Why it is needed

An [LSM Tree](chunk://lsm-tree) never modifies an SSTable once written. UPDATE writes a new version into a new file. DELETE writes a tombstone into a new file. So the same key ends up spread across many files:

```
SSTable-001:  user_id=8821, name="Alice",   email="a@x.com",  ts=T1
SSTable-014:  user_id=8821, name="Alice_2",                   ts=T2   ← only name changed
SSTable-039:  user_id=8821, tombstone (whole row deleted)      ts=T3
```

UPDATE writes only the columns that changed, and conflict resolution compares writetime column by column, so reading a whole row cannot stop at the newest file. Here name is in 014 and email is still in 001. Every SSTable that might contain this partition has to be opened, the newest value of each column picked out, and the row stitched back together. There is no upper bound on the number of files, and each file carries its own index and [bloom filter](chunk://bloom-filter) resident in memory. So multiple SSTables are periodically merged into one, keeping only the version with the largest writetime for each column, and dropping the tombstone together with everything it covers.

## How the merge works

Each SSTable is already sorted by key internally, and the result has to stay sorted after the merge. The method is a k-way merge. Put the first record of each file into a min heap, pop the smallest and write it to the new file, then take the next record from the file it came from and push it into the heap.

```
A: 1, 4, 9      heap: {1(A), 2(B), 3(C)}  → pop 1, A pushes 4
B: 2, 5               {2(B), 3(C), 4(A)}  → pop 2, B pushes 5
C: 3, 8               {3(C), 4(A), 5(B)}  → pop 3 ...

Output: 1, 2, 3, 4, 5, 8, 9
```

N records across k files: time O(N log k), and the algorithm's space is O(k). Files are read as streams, so none has to be loaded whole (the process's actual memory also holds read and write buffers and the bloom filter being built, and those scale with N). This is also the solution to merge k sorted lists (LeetCode problem 23: given k lists each in increasing order, merge them into one increasing list). The difference is that the problem outputs both copies of a duplicate value, while compaction keeps only one copy of a duplicate key.

A tombstone cannot be dropped as soon as the merge finishes. Across nodes it has to wait out `gc_grace_seconds` (default ten days). Otherwise the tombstone disappears first, another replica has not yet received the delete, and read repair syncs the old data back. On the local node there is a further requirement: this compaction round has to include every SSTable holding older data for the key. Otherwise, once the tombstone is dropped, the old data in the file this round skipped gets read again. This last condition directly decides how a strategy picks files.

## Three strategies

Write amplification is how many times one piece of data is rewritten in total between its first write and its final resting place. LSM accepts write amplification in exchange for every write being a sequential write.

| Strategy | Rule | Benefit | Cost |
|---|---|---|---|
| STCS (SizeTiered, default) | Triggers when `min_threshold` (default 4) files of similar size pile up; one round merges at most `max_threshold` (default 32) | Total write amplification is single digit: data is rewritten once per size tier, and the tier count is a log whose base is the merge width | Old versions sit in big files for a long time, wasting disk; the number of files a read opens is unpredictable; tombstones cannot cover old data in big files, so it never gets cleaned |
| LCS (Leveled) | Files are a fixed 160MB per level; from L1 up, key ranges within a level do not overlap | Looking up one key reads at most one file per level from L1 up | Total write amplification is tens of times: worst case per level equals the fanout (default 10), summed across levels. L0 does not promise that ranges stay apart and can pile up to 32 files before its own STCS round triggers, so when compaction falls behind writes, a read opens more files than under STCS |
| TWCS (TimeWindow) | Split by time window; once a window closes it never merges with other windows | When a whole window expires the whole SSTable is dropped, no merge needed | Only fits data appended by time and expired by TTL. With scheduled DELETEs the tombstone lands in the new window and the data in the old one, and the two are never in the same merge round. And expiry does not mean an immediate drop: `gc_grace_seconds` still applies, and it has to be confirmed that this file does not shadow data in another |

STCS total write amplification is single digit; LCS is tens of times. The extra rewrites LCS pays buy this: looking up one key reads at most one file per level from L1 up.
