---
title: "Aurora"
slug: aurora
brief: "Aurora splits compute and storage into two layers: the compute layer runs leader-follower, the storage layer runs quorum."
date: 2026-03-26
updated: 2026-10-17
revisions: 1
---

# Aurora

> AWS's managed relational DB. Compatible with MySQL and PostgreSQL, but the storage underneath is a complete rewrite.

## Two layers

Aurora splits the DB into two layers: compute (SQL processing) and storage (where the data lives). In a traditional DB, compute and storage sit on the same machine. Split apart, the two layers scale separately.

```text
Compute layer (leader-follower):
  Writer (1 node) — handles all writes
  Reader (up to 15 nodes) — handles reads

Storage layer (quorum):
  Data is cut into 10 GB segments
  Each segment has 6 copies spread across 3 AZs (2 per AZ)
  All Writers / Readers share the same storage layer
```

## Storage: 10 GB segments × 6 copies

Traditional MySQL replication keeps a full copy of the data on every node and syncs them through the binlog (PostgreSQL uses WAL streaming). In Aurora every node shares one distributed storage layer.

```text
Traditional MySQL:
  Leader  [own SSD] → binlog → Follower [own SSD]
  one copy per node, replication has lag

Aurora:
  Writer  ──┐
  Reader 1 ─┤── shared storage (10 GB segments × 6 copies)
  Reader 2 ─┘
  no data copying, replica lag is usually well under 100ms
```

1 TB of data → cut into 100 segments of 10 GB → 6 copies each → 600 pieces spread across different storage nodes.

### The storage layer uses quorum, with no leader

The storage layer elects no leader. Each 10 GB segment runs its own quorum:

```text
Write: 4 of 6 copies confirm → success (W=4)
Read:  3 of 6 copies confirm → success (R=3)
W + R = 7 > N = 6 → a read always includes the latest write
```

If a whole AZ goes down (losing 2 copies), 4 remain and writes continue as normal. The broken copies are repaired automatically without affecting other blocks.

```text
Raft/Paxos: elect one leader, all writes go through it → etcd, ZooKeeper
Quorum:     no leader, each write asks a majority of nodes directly → Aurora storage layer
```

## Compute layer: Leader-Follower

The Writer handles writes, the Readers handle reads. Because they share one storage layer, adding a Reader does not mean copying the whole dataset.

## How failover works: promote a reader

When the Writer dies, Aurora promotes the first Reader in the preset priority order (priority tier) to be the new Writer.

```text
Writer (dead)
Reader 1 (priority 0) ← promoted directly to new Writer
Reader 2 (priority 1)
Reader 3 (priority 2)
```

No Raft election is needed, because the storage is shared. The new Writer takes over the same storage: no data to copy, no log to catch up on, no consensus to reach with other nodes.

**Elections exist to resolve "data divergence"**: in traditional replication every node holds its own copy, the copies may differ, and an election picks the node with the newest data as leader. In Aurora everyone shares one storage, there is no divergence to resolve, so any node can be promoted and no vote is needed.

Failover takes about 30 seconds. The slow parts are the DNS endpoint switch and rebuilding connections, not an election.

## Applications connect to a DNS endpoint

Aurora offers two endpoints:

```text
Writer endpoint:  mydb.cluster-xxx.rds.amazonaws.com     → points at the Writer
Reader endpoint:  mydb.cluster-ro-xxx.rds.amazonaws.com  → points at the Readers

DBeaver connects to the Writer endpoint → sees one DB
Behind it: a Writer + several Readers + 6 copies of storage
The connecting side does not need to know any of this
```

Connecting to the Reader endpoint also works and shows the same data, but only SELECT is allowed, not INSERT/UPDATE.
