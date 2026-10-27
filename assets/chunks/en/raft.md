---
title: "Raft"
slug: raft
brief: "Leader election plus log replication. Designed to be understood."
date: 2026-03-09
updated: 2026-10-18
revisions: 3
---

# Raft

Raft is a distributed consensus algorithm: a group of nodes agrees on every data change, and losing a minority of machines does not change the outcome. [Paxos](chunk://paxos) solved this long ago but is hard to understand; Raft does the same job with one plain design goal, that people can follow it.

## How it works

Three nodes N1, N2 and N3, with N1 as leader. Every node holds a log, entries appended one after another, and a state, which is the result of replaying the log from the start.

A client sends `set x=5`, and this happens in order:

```text
client → N1: set x=5
N1 appends set x=5 as entry 7 of its log, not yet applied to state
N1 → N2, N3: entry 7 is set x=5, replicate it
N2 writes it to its log and replies to N1; N3 is slower and has not replied
N1 counts: itself plus N2 is two votes, two of three, entry 7 is committed
N1 applies x=5 to its state and replies to the client: success
N3 catches up a little later and commits entry 7 as well
```

Only the leader accepts writes, so one node alone decides the order of the log. The committed part of the three logs is identical, and so is the state replayed from it. The uncommitted tail can differ, and the example of N1 losing power below has one such entry. The commit threshold is a majority: two of three nodes, three of five. So three nodes can lose one and five nodes can lose two, and the data is still on the remaining majority.

Now N1 loses power. N2 and N3 normally receive a heartbeat from N1 about every 100ms, and now it stops. Each follower waits a random length of time; say N2 drew 150ms and N3 drew 280ms. At 150ms N2 times out first, increments the term, becomes a candidate, votes for itself, and asks N3 for a vote. N3 is still waiting, receives the request, sees that N2's log is no older than its own, and votes for N2. N2 has two votes, a majority, becomes the new leader and starts sending heartbeats. N3 receives one and settles down, so it never starts an election of its own. The random wait exists for this: if both timed out at 150ms, each would vote for itself, one against one, and another round would be needed.

Say that just before losing power, N1 had appended a client's `set y=1` as entry 8 of its own log and had not replicated it yet. N1 is repaired and reboots. A Raft node always starts as a follower, so N1 wakes up as a follower and does not come back as leader. N2's heartbeat arrives with a higher term, and N1 updates its term to N2's. A heartbeat is in fact an AppendEntries with no data. N2 uses it to compare logs with N1, finds that both agree up to entry 7, has N1 delete the entries after entry 7, and then pushes its own later log entries to N1. N1's `set y=1` never reached a majority, so it was never committed; the client never got a success reply either, and the write is treated as if it never happened.

## Trade-offs

- Easier to understand than Paxos and more direct to implement; etcd, Consul and CockroachDB all use it
- Strong consistency: once committed, data ends up the same on every node
- Leader failover takes a few hundred milliseconds, which clients barely notice
- A write waits for a majority to reply, so latency is higher than a single node
- Every write goes through the one leader, so write throughput is bounded by that machine
