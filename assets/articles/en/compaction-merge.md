---
title: "merge k sorted lists: the algorithm that keeps showing up when write-heavy databases compact"
slug: compaction-merge
date: 2026-09-01
updated: 2026-10-17
revisions: 1
subtitle: "In a system that only appends, the number of files keeps growing, so k sorted files have to be merged into one on a regular basis."
chapter: "storage"
tags: [compaction, lsm-tree, k-way-merge, cassandra, clickhouse, lucene, storage]
related: [storage-internal, the-log]
---

# merge k sorted lists: the algorithm that keeps showing up when write-heavy databases compact

A Cassandra node has been running for one day, and its data directory holds 47 SSTable files. To read the row `user_id=8821`, every file that might contain this key has to be opened, because different columns of that one row can be spread across different files.

The next morning, 6 remain.

What ran in between is compaction.

---

## Why it piles up to 47

The [LSM Tree](chunk://lsm-tree) write path ends at the SSTable. When the memtable fills up, it is flushed into one file, and once written the file is immutable. It is never modified again. An UPDATE does not go back and change the old file. It writes a new version into the new memtable, which is later flushed into another file. DELETE is the same: it writes a tombstone.

So one key ends up like this:

```
SSTable-001:  user_id=8821, name="Alice",   email="a@x.com",  ts=T1
SSTable-014:  user_id=8821, name="Alice_2",                   ts=T2   ← the UPDATE only changed name
SSTable-039:  user_id=8821, tombstone (whole row deleted)     ts=T3
```

Three versions, spread over three files. You cannot stop at "just find the newest one", because a Cassandra UPDATE writes only the columns that changed, and conflict resolution compares writetime column by column. For the same row, name may be in SSTable-014 while email still sits in SSTable-001. Reading a whole row means opening every SSTable that might contain this partition, picking the cell with the largest timestamp for each column, and assembling the row again.

A [Bloom filter](chunk://bloom-filter) can skip most of the files that do not contain this key, but the file count is a cost in itself. Every SSTable has its own index and bloom filter resident in memory, and 47 files means 47 copies.

The faster the writes, the faster the files pile up. Append-only turns writes into sequential writes, and the price is a growing pile of files.

---

## Why not read everything into memory and sort

Each SSTable is already sorted by key internally. That is what the name Sorted String Table means. The merged result has to stay sorted too, otherwise binary search on read no longer works.

The most direct approach is to read everything into memory, concatenate it, sort once, and write it out.

That does not work. A single SSTable of several hundred MB is common, and 47 of them add up to several GB. Compaction is background work. It cannot use up the whole machine's memory, or the foreground reads and writes have none left.

And every file is already sorted, so this throws that condition away. Sorting from scratch is O(N log N), but the input is already ordered, and it does not need that much.

---

## Start with three files

Three files, two or three records each:

```
A: 1, 4, 9
B: 2, 5
C: 3, 8
```

The output has to be `1, 2, 3, 4, 5, 8, 9`.

At each step there is only one question: of the records at the front of the three files right now, which is the smallest?

Step one: the front of A is 1, B is 2, C is 3. The smallest is 1, so write it out. A reads one record forward, and its front becomes 4.

Step two: A=4, B=2, C=3. The smallest is 2, write it out. B advances, and its front becomes 5.

Each record written out replaces only one candidate. The other k−1 do not move at all, so the next step does not need to compare all of them again. A min heap provides exactly these two operations: take out the smallest in O(log k), and push one new record in, also O(log k).

The full run:

```
heap at start: {1(A), 2(B), 3(C)}      ← the first record of each file

pop 1(A)  → output 1, fetch the next record 4 from A, push
heap:      {2(B), 3(C), 4(A)}

pop 2(B)  → output 2, fetch the next record 5 from B, push
heap:      {3(C), 4(A), 5(B)}

pop 3(C)  → output 3, fetch the next record 8 from C, push
heap:      {4(A), 5(B), 8(C)}

pop 4(A)  → output 4, fetch the next record 9 from A, push
heap:      {5(B), 8(C), 9(A)}

pop 5(B)  → output 5, B has no next record, no push
heap:      {8(C), 9(A)}

pop 8(C)  → output 8, C is done too
heap:      {9(A)}

pop 9(A)  → output 9, A is done too
heap:      {}                       ← finished
```

Output `1, 2, 3, 4, 5, 8, 9`, sorted.

---

## The cost

N is the total number of records, k the number of files.

Each record enters the heap once and leaves it once, O(log k) each, O(N log k) in total.

The algorithm's own space is O(k). The heap holds only k records at a time, so 47 files means 47 records. Files are read as streams, so none has to be loaded whole.

Compared with "read everything and sort", time goes from O(N log N) to O(N log k), where N is hundreds of millions and k is a few dozen. Space goes from proportional to N to proportional to k.

O(k) is the algorithm's space, not the memory the compaction process actually uses. A real run also has a read buffer per input file, a write buffer for the output, and the new bloom filter being built, and that last one is proportional to N, not k. What k-way merge removes is the constraint "all the data must be in memory at the same time". It does not push memory use down to some fixed number.

This algorithm is called k-way merge.

---

## Written as code, it is merge k sorted lists

```ts
type Cursor = { value: number; fileIdx: number };

function kWayMerge(files: number[][]): number[] {
  const heap = new MinHeap<Cursor>((a, b) => a.value - b.value);
  const pos = files.map(() => 0);

  // the first record of each file goes into the heap first
  files.forEach((f, i) => {
    if (f.length > 0) heap.push({ value: f[0], fileIdx: i });
  });

  const out: number[] = [];
  while (heap.size > 0) {
    const { value, fileIdx } = heap.pop();
    out.push(value);

    pos[fileIdx] += 1;
    const next = files[fileIdx][pos[fileIdx]];
    if (next !== undefined) heap.push({ value: next, fileIdx });
  }
  return out;
}
```

What the heap holds is not a plain value but `{ value, fileIdx }`. `fileIdx` cannot be dropped, because after a pop you need to know which file to fetch the next record from.

The code above is LeetCode problem 23, merge k sorted lists. The problem gives k linked lists, each already ascending, and asks for one ascending list. That version uses ListNode, and `node.next` takes the place of `fileIdx`. Same structure, different spelling.

---

## What real compaction has that the problem does not

Duplicate values: merge k sorted lists keeps both, compaction can keep only one.

The problem's sample input is `[[1,4,5],[1,3,4],[2,6]]` and the answer is `1,1,2,3,4,4,5,6`. Both 1s are output, because those two 1s have no identity. They are two independent records. In compaction, `user_id=8821` appeared in all three SSTables, so the pops meet it three times in a row, but those are three versions of the same row and only one can stay.

Which one? Compare the cell writetime, larger wins, and the comparison is column by column. That timestamp is written inside the data itself, not in the file name. An SSTable file name carries an increasing generation number, for example the `1` in `nb-1-big-Data.db`. Cassandra 4.1 added an option to replace that number with an ID based on a Time UUID that starts with the creation time, but in the default `cassandra.yaml` of 5.0 the option is still off (`uuid_sstable_identifiers_enabled: false`). Neither the increasing number nor the time based ID can judge old from new, because the big file compaction has just written out gets the largest number and the latest time while holding old data. `fileIdx` has only one purpose: knowing which file to fetch the next record from after a pop.

The third version is a tombstone, meaning this row has been deleted. During the merge the whole set is dropped and nothing is output.

But the tombstone itself cannot be dropped right away.

What if this node's tombstone disappears first? Another replica on a different node has not received the delete yet. On the next read repair (a read notices the replicas disagree and copies the newer version to the others), that old record is treated as valid data and synced back, and the deleted data comes back to life. So Cassandra has `gc_grace_seconds`, default 864000 seconds, which is ten days. A tombstone has to be kept longer than that before it can be dropped.

Ten days is not enough on its own. Looking at one machine alone, deleted data can come back too. **This round of compaction must also cover every SSTable that holds older data.** Say the tombstone is in SSTable-039, the old data with `ts=T1` is in SSTable-001, and this round only picked 014 and 039 to merge. Once the tombstone is dropped, the old data in 001 is no longer shadowed by any tombstone, and the next read returns `name="Alice"`. This happens on a single node and has nothing to do with the other replicas.

So "which files go into the same heap" decides not only disk IO but also when a tombstone can be cleared.

There is one more difference on the output side. The problem outputs one list. Compaction outputs one file, and while writing it has to build the index block and the bloom filter. Only when the file is complete can the read path use it.

---

## Why these systems ended up looking the same

Cassandra was first built at Facebook for inbox search, a scenario with far more writes than reads that also had to scale horizontally to hundreds of machines. ClickHouse came from web traffic analytics at Yandex, with hundreds of thousands of events per second written continuously and aggregate queries running at the same time. Lucene solves full text search. Once an [inverted index](chunk://search-inverted-index) is built, changing one term is expensive, so a write becomes a new segment.

Three different scenarios, but the constraints they face are the same set:

```
writes must be fast           → only sequential writes → data can only be appended into new files
new files must be queryable   → each file must be sorted internally
no upper bound on file count  → must merge on a regular basis
merge must keep order         → and cannot load all the data into memory
```

Follow it to the last line: merging several sorted files into one sorted file is k-way merge.

This chain has a precondition: the key ranges of those files must interleave. When that does not hold, there is no need to merge at all. TWCS (TimeWindowCompactionStrategy) lets a whole time window of data expire together, and on expiry the entire file is deleted, with no key to compare. Leveled compaction also has a shortcut called trivial move: if a file heading for the next level has a key range that does not overlap with that level at all, the file is moved down directly, with no read and no rewrite. Neither case goes through the heap.

When a merge really is needed, all three do the same thing under different names:

| System | Immutable unit | Name of the merge | Default strategy |
|---|---|---|---|
| Cassandra | SSTable | compaction | SizeTieredCompactionStrategy |
| ClickHouse | part (sorted by the ORDER BY key) | merge | the MergeTree background merge |
| Lucene / [Elasticsearch](chunk://elasticsearch) | segment | merge | TieredMergePolicy |

ClickHouse even put it in the engine name, MergeTree.

But not all the data in one merge takes the same path. ClickHouse and Lucene both split the data of one merge in two: only the part carrying the sort key goes into the heap, and the other part is moved by copying or reordering. Cassandra has no such second part.

ClickHouse shows it most clearly, because it is columnar. It has two merge paths, horizontal and vertical, and `enable_vertical_merge_algorithm` defaults to 1. On the vertical path only the ORDER BY columns go through the merge sort, and along the way it records "which part did output row n come from" as a rows_sources. The remaining columns (called `gathering_columns` in the source code) are read in one column at a time, reordered according to that rows_sources, and written out, with no comparison at all.

There are two thresholds for switching to vertical. The row one compares **the row counts of all source parts in this merge added together** against `vertical_merge_algorithm_min_rows_to_activate` (default 131072), not a single part. The column one checks that there are at least `vertical_merge_algorithm_min_columns_to_activate` columns (default 11) besides the sort key [the defaults come from the merge-tree-settings page on clickhouse.com; which row count is compared I read from a secondhand description of `chooseMergeAlgorithm` in `MergeTask.cpp`, and I did not read that source code].

ClickHouse's own advice is "inserting data in batches of at least 1,000 rows, and ideally between 10,000–100,000 rows", and the data of one flush is split into multiple parts only when it exceeds `max_insert_block_size` (default about one million rows) [SRC: clickhouse.com/docs/best-practices/selecting-an-insert-strategy].

A batch of 100,000 rows becomes one part of 100,000 rows, two of them together pass 130,000, and the first merge round already goes vertical. With batches of 1,000 rows it takes 131 parts to pass the threshold, so the first few rounds go horizontal and compare the whole data set.

Lucene splits the same way. The term dictionary layer really runs a k-way merge: `MultiTermsEnum` holds a `TermMergeQueue extends PriorityQueue<TermsEnumWithSlice>` and merges the terms enum of each segment in term dictionary order. The shared key domain here is the term, not the doc id, so doc ids being renumbered during the merge does not affect the comparison. But stored fields take another path. When the source segment has no deletions (`mergeState.liveDocs[readerIndex] == null`) and the compression settings match, `Lucene90CompressingStoredFieldsWriter` picks `MergeStrategy.BULK` and copies whole chunks in compressed form, skipping even the decompression.

Cassandra has no such split. All the data goes through the comparison. Its SSTable stores all columns of a row together, and every cell compaction reads in walks through the merge iterator with its partition key. No part can skip the comparison.

ClickHouse keeps each column on its own, and Lucene keeps stored fields in their own compressed chunks. Those units can skip the sort and be copied or reordered directly. Cassandra has no unit like that, so it cannot save those comparisons.

So k-way merge covers only the sorting layer. Columnar and segment style systems pull out the payload that takes no part in sorting and copy or reorder it, saving whatever comparisons can be saved.

[The Log](article://the-log) explains why the append-only approach shows up everywhere, in Raft, Kafka, WAL and CDC. Compaction deals with the files that append leaves behind. A system that only appends must merge on a regular basis, or there is no upper bound on the file count.

---

## When to merge, and which files

47 files never all go into one heap at once. Which files to merge each time is decided by the compaction strategy.

Say a time-series table takes two hundred million rows a day, about 50 bytes per row, and most queries concentrate on the last hour. Three months is 1.8×10¹⁰ rows, about 900GB on disk. Every tier count and level count below is computed from this 900GB.

**Start with the default STCS (SizeTiered)**. The rule groups SSTables of similar size: a file whose size falls between 50% and 150% of a bucket's average goes into that bucket, and the merge width is pinned between two thresholds. A merge triggers only once `min_threshold` (default 4) have accumulated, and one round merges at most `max_threshold` (default 32) [SRC: cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/stcs.html]. So the narrowest case is four 500MB files merging into one 2GB, four 2GB files into 8GB, round after round upward. The widest case is thirty-two 500MB files merging into 16GB in a single round, where the narrow path would take two or three rounds to reach the same size. Where it actually lands depends on how many have accumulated in the bucket by the time compaction gets to it, that is, whether the scheduling frequency or the flush rate is faster.

Write amplification is low, because each record is rewritten few times.

**After three months, disk usage is more than twice the actual data**. The reason is that STCS leaves a few very large SSTables behind. Old versions of a key stay in the large files and are cleared only when "another full group of large files of the same size" is assembled, and large files take a long time to assemble.

Tombstones have the same problem, and worse. As said above, dropping a tombstone has to cover every SSTable holding older data, and STCS only picks files from one size tier to merge. That tier by its nature does not cover the old versions sitting in the large files. The result is that the tombstone and the data it should delete are both kept, taking more space than before the delete.

Worse, the moment of the merge also needs free disk equal to the input, because old and new files exist at the same time.

Meanwhile p99 read latency does not come down. One key can exist in files from several buckets at once, and the bloom filter does nothing for those files, because the key really is in them.

**Switch to LCS (Leveled)**. The rule is completely different. File size per level is fixed (`sstable_size_in_mb`, default 160), and from L1 up, SSTables on the same level are guaranteed not to overlap in key range. A query for one key reads at most one file per level from L1 up.

The target capacity of L1 is `sstable_size_in_mb` times `fanout_size` (default 10), that is 1.6GB, and each level up multiplies by ten again: L2 16GB, L3 160GB, L4 1.6TB. 900GB lands in L4 without filling it, so four levels.

L0 does not count under "one file per level". SSTables flushed from the memtable land in L0 first, where "SSTables are not guaranteed to be non-overlapping", and a round of STCS inside L0 triggers only once more than 32 have piled up [SRC: cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/lcs.html]. So the number of files a query opens is however many L0 holds, plus four. When compaction keeps up, L0 holds a few and the total is a single digit, better than the dozen or so under STCS. When it does not keep up, L0 alone can reach 32, worse than before the switch.

**The price is a large rise in write amplification**, and the size of it is not "one rewrite per level climbed". Pushing a file from L(n) to L(n+1) means every file on the next level whose key range overlaps it is read out and rewritten together with it. The capacity ratio between levels is 10, so the number of overlapping files is also on the order of 10. Per level, the worst case write amplification equals the fanout, and in practice it is somewhat less [the RocksDB compaction document puts it as "The per-level write amplification is equal to the fanout in the worst case, but it tends to be less than the fanout in practice"]. 900GB is four levels, so the accumulated total is a few dozen times, not four.

To compare with STCS you need the same unit and the same data volume: both as totals, both at 900GB. Under STCS each record is rewritten once per size tier it climbs, the base of the tier count is the merge width, and the width lands between 4 and 32. With 500MB flushes and 900GB total, that is 1800 pieces: width 4 gives log₄(1800) ≈ 5.4 tiers, width 32 gives log₃₂(1800) ≈ 2.2. Total write amplification is between 2 and 5, a single digit. LCS at the same 900GB is four levels, each level at worst times the fanout, accumulated, landing in the tens. Both ends of the range are an order of magnitude away from LCS, and this comparison does not depend on where the width lands.

[The RocksDB document separately says that for tiered the "per-level write amplification is 1". That is a statement about the tiered class, not a measurement of Cassandra STCS, and STCS is structured as size buckets, not levels, so a per-level number carried over would be read as a total.]

**After switching to LCS, when does it hurt?** Write volume keeps climbing, and compaction can no longer keep pace with flushes. Pending tasks in `nodetool compactionstats` keep accumulating and never drop, and the number of L0 SSTables keeps growing. That is the sign. At that point the original reason for switching to LCS no longer holds. The number of files a read opens becomes the L0 pile plus four, more than under the original STCS, while the price of higher write amplification has already been paid. From here the options are to add machines and spread the writes out, to switch back to STCS and accept slower reads, or to go back and examine the write and delete pattern of the data.

That last option works best on time-series data, but the conditions are narrow. The data has to be appended by time only, and **expiry has to come from a TTL set at write time, not from a scheduled DELETE**. When that holds, use TWCS (TimeWindow), which splits SSTables by time window, uses STCS inside one window, and stops merging a window with other windows once it closes. A whole window of data expires together, the whole SSTable is dropped, and not a single merge runs.

"Expires together" does not mean dropped the moment it expires. Data whose TTL has run out counts as a tombstone itself, so `gc_grace_seconds` still applies: `CompactionController.getFullyExpiredSSTables` compares `candidate.getMaxLocalDeletionTime() < gcBefore`, and `gcBefore` is now minus the gc grace. After that time passes, it still has to confirm this SSTable does not shadow data in any other SSTable, the same local condition as in the tombstone section above. Cassandra has an option called `unsafe_aggressive_sstable_expiration` that skips that second check. The official document describes it as "Expired SSTables will be dropped without checking its data is shadowing other SSTables", marks it as "a potentially risky option that can lead to data loss or deleted data re-appearing", and requires a separate JVM flag to enable it. So once a window expires, disk space is not released right away, and capacity planning has to include that wait.

A scheduled DELETE is the worst case under TWCS. The tombstone a DELETE produces carries the current timestamp, so it lands in the SSTable of the **current** window, while the data it should delete is in an **old** window. Once a window closes the two windows never merge again, the tombstone never reaches the data it should delete, and neither side can ever be cleared.

---

The three strategies distribute the costs of read, write and space differently. That is the concrete shape of the RUM (Read, Update, Memory overhead) trade-off mentioned at the end of [storage-internal](article://storage-internal). The sorting layer has always been the same piece of k-way merge. What the strategy decides is which files go into this round's sort and which are skipped whole. Inside one file there is a further split: columnar and segment style systems let only the part carrying the sort key into the heap, and the rest is reordered by permutation or copied as a block.
