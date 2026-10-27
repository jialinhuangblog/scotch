---
title: "2PC (Two-Phase Commit)"
slug: 2pc
brief: "Two-phase commit. Its biggest weakness: if the coordinator dies between the two phases, every node sits holding locks, waiting for it to come back."
date: 2026-03-16
---

# 2PC (Two-Phase Commit)

> A protocol for distributed transactions. Used when an operation across several nodes has to "all succeed or all fail".

## The problem

A transfer: A sends money to B. If both users live in the same DB, this is an ordinary single-machine transaction. The DB guarantees atomicity on its own, and no 2PC is needed.

The problem starts when there are too many users for one machine and the table is split across several by [sharding](chunk://sharding). A's account may land on DB-1 and B's on DB-2: logically the same users table, physically different machines. Deducting from A (DB-1) and adding to B (DB-2) must succeed together or fail together, but each machine runs its own transaction, and DB-1 has no idea whether DB-2 succeeded or failed.

## The two phases

Add one role: the **Coordinator**, which directs the nodes.

**Phase 1 — Prepare (vote)**

The coordinator asks every node: "Are you ready to commit?"

Each node performs the operation (without committing) and replies YES or NO.

**Phase 2 — Commit / Abort (execute)**

- Everyone replied YES → the coordinator sends Commit to all nodes
- Any node replied NO → the coordinator sends Abort to all nodes, and everyone rolls back

```text
Coordinator         DB-1 (deduct A)    DB-2 (add B)

Phase 1:
  Prepare ─────────→  deduct A, lock row
                       YES ──────────→
  Prepare ──────────────────────────→  add B, lock row
                                       YES ──────────→

Phase 2:
  Commit ──────────→  commit, unlock
  Commit ───────────────────────────→  commit, unlock
```

## The coordinator dies

This is the biggest weakness of 2PC. If the coordinator dies after Phase 1 and before Phase 2:

- The nodes have already replied YES, their rows are locked, and they wait for the coordinator's instruction
- The coordinator does not come back, and the nodes cannot tell whether to commit or abort
- The rows stay locked, and every other transaction that touches them has to wait

This is the **blocking problem**. The nodes can only wait for the coordinator to recover, or for a human to step in.

## The 3PC attempt

Three-Phase Commit adds a middle phase (pre-commit) to shrink the blocking window. In practice it is rarely used, because:
- One more round trip, so it is slower
- It can still end up inconsistent during a network partition
- Most systems moved to other approaches (the Saga pattern)

## What is done in practice

Most systems avoid cross-node transactions as much as they can. Common alternatives:

| Approach | How |
|---|---|
| Co-locate | Put related data on the same shard, so no cross-node transaction is needed |
| Saga pattern | Split into several local transactions plus compensating operations (undo in reverse on failure) |
| Eventual consistency | Accept a short period of inconsistency and fix it later with background reconciliation |
