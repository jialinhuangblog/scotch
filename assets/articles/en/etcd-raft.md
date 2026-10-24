---
title: "etcd and Raft: how three nodes decide which write counts"
slug: etcd-raft
date: 2026-03-09
updated: 2026-10-17
revisions: 2
subtitle: "With 3 nodes, lose 1 and writes continue; lose 2 and writes stop, because Raft needs a majority to confirm before a write counts as successful."
chapter: "extras"
tags: [etcd, raft, consensus, distributed-systems]
related: [k8s-planes, the-log, replication-cap]
---

# etcd and Raft: how three nodes decide which write counts

[The previous article](article://k8s-planes) covered how k8s stores all of its state in [etcd](chunk://etcd), and etcd runs on 3 nodes. If writing to 1 node counted, the data would be gone the moment that node died.

So how many nodes must a write reach before it counts as "success"?

---

## Majority rule: Quorum

If all 3 had to succeed, any single node going down would stop the whole cluster from writing. That is more fragile than 1 node.

[Raft](chunk://raft)'s answer is **majority rule**. With 3 nodes, a write that reaches 2 counts as successful. This is called a quorum.

- 3 nodes → quorum 2 → tolerates 1 down
- 5 nodes → quorum 3 → tolerates 2 down

When a downed node comes back, the leader sends it the entries it missed.

## One Leader, no more

Can all 3 nodes accept writes? No.

Imagine Node A receives "x = 1" while Node B receives "x = 2" at the same time. Should x end up as 1 or 2? Each node recorded its own value, and there is no basis for deciding which one is right. This is **[split brain](chunk://split-brain)** (two leaders, data split in two).

Raft requires that **only one leader accepts writes**. The other nodes are called followers.

```
Client → Leader (write) → replicate to Follower 1, Follower 2
                        → 2 confirmations (including itself) → reply to Client "success"
```

Every write goes through the same leader, so the order is fixed.

## The Leader dies: election

After the leader dies, nobody is in charge of naming a successor. The followers have to elect one themselves.

The leader sends heartbeats to the followers on a schedule. If a follower goes a while without receiving one, it concludes the leader is dead and starts a vote.

```
Leader dies
→ Follower A times out, starts an election: "vote for me"
→ Follower B: "your data is new enough, OK"
→ Follower A gets 2 votes → becomes the new leader
→ the cluster keeps running
```

The whole process takes a few hundred milliseconds (the Raft paper's figures; etcd defaults to a 1 second election timeout, so a real leader change takes about 1 to 2 seconds). The client barely notices.

### What if two start an election at the same time?

A and B both decide the leader is dead at the same moment and both start an election. A votes for itself, B votes for itself, 1 vote each, and neither has a majority.

Raft solves this with a **random timeout**. Before starting an election, each node waits a random length of time. A waits 150ms, B waits 280ms. A starts first; B receives A's request before its own timeout and votes for A.

## Log: the same structure as Kafka

What does the leader replicate to the followers? Not the final state, but the **[log](chunk://the-log)**: append-only, ordered, each entry with an index.

```
Index 1: SET x = 1
Index 2: SET y = 2
Index 3: DELETE x
Index 4: SET y = 5
```

The same concept as Kafka's log. Append-only: nothing in the middle can be changed, entries are only added at the tail.

The leader is responsible for making every follower's log identical to its own, order included.

```
Leader:     [1: SET x=1] [2: SET y=2] [3: DELETE x]
Follower A: [1: SET x=1] [2: SET y=2] [3: DELETE x]  ← consistent
Follower B: [1: SET x=1] [2: SET y=2]                 ← one entry short, just fill it in
```

## From Log to state: State Machine

The log records operations. But when etcd answers a query, it answers "what x equals right now".

The step in between is replaying the log entry by entry onto a key-value store.

```
Log:                          State:
[1: SET x=1]  → apply →      { x: 1 }
[2: SET y=2]  → apply →      { x: 1, y: 2 }
[3: DELETE x] → apply →      { y: 2 }
```

This state is called the **state machine**. Raft's full name: **a consensus algorithm for replicated state machines.**

Every node has the same log → replaying gives the same state → every node's key-value store holds the same content. On a read, etcd first confirms the latest commit position with the leader before answering, so what is read is also the latest (see [replication-cap](article://replication-cap)).

---

## The four parts of Raft

```
          ┌─────────────┐
Client →  │   Leader    │ ← the only node that accepts writes
          └──────┬──────┘
   replicate log │
       ┌─────────┼─────────┐
       ▼                   ▼
  ┌──────────┐       ┌──────────┐
  │Follower A│       │Follower B│
  └──────────┘       └──────────┘

1. Leader election — the leader dies, an election follows; a random timeout breaks ties
2. Log replication — the leader copies the log to the followers
3. Quorum — majority rule, 2 of 3 confirmations means commit
4. State machine — the log replays into the final state
```

---

## Terms, log conflicts, snapshots, and Paxos

**Term** — Raft's "term of office" number; every election adds 1 to the term. When an old leader comes back after a disconnection, its term is smaller, and the other nodes reject the requests it sends.

**Log conflict** — how to repair a follower's log when it disagrees with the leader's. The leader finds the last index where they agree and overwrites from there.

**Snapshot** — the log cannot grow forever. Save a snapshot of the state machine periodically, and the older log can be discarded.

**[Paxos](chunk://paxos)** — the consensus algorithm before Raft. Correct, but famously hard to understand. Raft's design goal was "people should be able to understand it".
