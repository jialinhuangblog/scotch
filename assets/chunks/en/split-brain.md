---
title: "Split Brain"
slug: split-brain
brief: "Two leaders appear at the same time, each accepting writes. When the network recovers, each side holds a batch of writes the other does not have."
date: 2026-03-16
---

# Split Brain

> A failure mode of distributed systems. Both leader-follower and consensus architectures can run into it.

## What split brain is

The network splits, and the cluster falls into two halves. Each half elects its own leader and accepts its own writes. When the network recovers, each side holds a batch of writes the other side does not have.

```text
Normal:
  [Leader] ←→ [Follower A] ←→ [Follower B]

Network split:
  [Old Leader] ←→ [Follower A]     |     [Follower B → elects itself Leader]
  each accepting writes...          |     each accepting writes...

Network recovers:
  The two sides hold different data. Which one is right?
```

## Why it happens

In a leader-follower architecture, followers use heartbeats to decide whether the leader is alive. No heartbeat → assume the leader is down → start an election.

But "no heartbeat" does not mean the leader is really down. It may just be network latency or a short disconnect. The old leader is still alive and still accepting writes, while the other side has already elected a new leader. Two leaders at the same time: that is split brain.

## How to prevent it

### Quorum (majority vote)

Raft's approach: both elections and writes need a majority of nodes to agree.

3 nodes split 2:1:
- The side with 2 can form a majority → elects a new leader → keeps serving
- The side with 1 cannot form a majority → no election possible → stops accepting writes

The minority side stops on its own, so two leaders never appear.

### Fencing Token

Give each leader term an increasing token. The old leader (token=5) comes back and tries to write; the storage layer sees it already has writes with token=6 → rejects the token=5 operation.

```text
Leader A (token=5): I want to write
Storage: latest token is 6, rejected
Leader B (token=6): I want to write
Storage: OK
```

### STONITH (Shoot The Other Node In The Head)

When a possible split brain is detected, force the other machine off outright (through hardware means such as IPMI or cutting power at the PDU). Once the old leader has no power, it cannot keep writing.

Common in traditional HA (High Availability) clusters.

## How each system handles it

| System | How it prevents split brain |
|---|---|
| etcd / Raft | Quorum. The minority cannot elect or write |
| MongoDB | Raft election. The minority side's primary steps down automatically |
| Kafka | The ISR mechanism. When the leader dies, the new one is picked from the ISR; replicas outside the ISR cannot be picked |
| Redis Sentinel | Sentinels vote to decide the failover, but during the failover there is a short window where split brain is possible |
| PostgreSQL + Patroni | Uses etcd/ZooKeeper as a distributed lock, combined with fencing |
