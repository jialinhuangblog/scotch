---
title: "Paxos"
slug: paxos
brief: "The ancestor of consensus algorithms. Correct, and famously hard to implement."
date: 2026-03-16
updated: 2026-10-17
revisions: 1
---

# Paxos

> A consensus algorithm for distributed systems, proposed by Leslie Lamport in 1989, more than twenty years before Raft.

## What problem it solves

Several nodes have to agree on "what is the value". For example: the nodes of a distributed DB have to agree that "log entry 5 is SET x=1".

Raft solves the same problem.

## Three roles

| Role | What it does |
|---|---|
| Proposer | Proposes: "I suggest the value is X" |
| Acceptor | Votes: "I accept" or "I reject" |
| Learner | Watches: "everyone has decided, I write it down" |

One node can play several roles at once.

## Two phases

**Phase 1: Prepare**

The Proposer picks an increasing proposal number N and sends Prepare(N) to every Acceptor.

The Acceptor's response:
- N is larger than any it has seen → replies "OK, and I promise not to accept any proposal smaller than N", and attaches the highest-numbered proposal it has already accepted, with its value (if any)
- otherwise → rejects

**Phase 2: Accept**

Once the Proposer has an OK from a majority of Acceptors, it sends Accept(N, value) to every Acceptor. The value is not free to choose: if any reply carried an already accepted value, the Proposer must use the one with the highest number; only when none did can it use its own. This rule is what makes Paxos safe; without it two majorities can choose different values.

An Acceptor that receives it accepts the value, unless it has promised a larger number in the meantime. A majority of Acceptors accept → consensus reached.

```text
Proposer           Acceptor A    Acceptor B    Acceptor C

Prepare(N=1) ────→  OK
Prepare(N=1) ──────────────────→  OK
Accept(N=1, "X") →  Accepted
Accept(N=1, "X") ─────────────→  Accepted
                                                consensus: "X"
```

## Why it is hard

1. **Several Proposers at once**: A proposes N=1, B proposes N=2, A's Accept is rejected (the Acceptors already promised N=2), so A comes back with a larger N. The two can keep overriding each other with ever larger numbers and never reach consensus (livelock).
2. **No fixed leader**: any node can be a Proposer, so conflicts are likely.
3. **The paper is hard to read**: Lamport describes the algorithm through a made-up parliament on the island of Paxos.

## How Raft simplifies it

Raft's core change: elect one fixed leader, and only the leader proposes.

| | Paxos | Raft |
|---|---|---|
| Who proposes | Any node | Only the leader |
| Conflicts | Several Proposers compete | None, only the leader proposes |
| Understandability | Famously hard to understand | Being understandable was a design goal |

In practice most new systems pick Raft (etcd, CockroachDB, TiKV). Paxos is used mainly inside Google (Chubby, Spanner).
