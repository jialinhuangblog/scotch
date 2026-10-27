---
title: "Clocks"
slug: clocks
brief: "The time problem in distributed systems: physical clocks are unreliable, so there are logical clocks, and hybrid clocks as the compromise."
date: 2026-03-16
updated: 2026-07-20
revisions: 1
---

# Clocks

> In a distributed system, the time each machine records on its own cannot be used directly to decide which event came first.

## Wall clocks are unreliable

Every machine has its own clock, but two machines' clocks are never perfectly in sync.

```text
Machine A's clock: 12:00:00.000
Machine B's clock: 12:00:00.150   ← 150ms fast
```

A writes x=1 at 12:00:00.000. B writes x=2 at 12:00:00.100 by its own clock. Judged by wall clock, B's timestamp is larger, so B wins. But B's clock is 150ms fast. Its real write time is 11:59:59.950, 50ms earlier than A, so the value that should survive is A's x=1.

NTP (Network Time Protocol) can sync clocks, but only to within a few milliseconds to tens of milliseconds. For a system doing tens of thousands of writes per second, that error is enough to scramble the order.

## Logical Clock

Instead of wall time, use an increasing counter. A [Lamport clock](chunk://lamport-clock) makes causal order show up in the counter values; a [vector clock](chunk://vector-clock) goes further and tells whether two events are causally related or concurrent.

## Hybrid Logical Clock (HLC)

The compromise CockroachDB uses: combine the wall clock with a logical counter. TiDB takes a different route: a central service, PD, hands out every timestamp (TSO, Timestamp Oracle).

```text
HLC = (physical_time, logical_counter)

Comparison rule: compare physical_time first; if equal, compare logical_counter
```

Most of the time the wall clock is used (its precision is enough). When the wall clocks are equal, the logical counter breaks the tie.

## Google TrueTime

Google Spanner takes the most extreme approach. GPS and atomic clocks keep the clock error across all data centers within a few milliseconds. The API returns not a point in time but an interval `[earliest, latest]`. If two operations' intervals do not overlap, their order is certain.

This needs a GPS receiver and an atomic clock in every data center. Most companies cannot build that themselves.
