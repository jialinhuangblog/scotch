---
title: "Partitions"
slug: partitions
brief: "A topic is split into partitions. What gets divided is which segment a message lands in, not the message itself."
date: 2026-06-12
updated: 2026-06-13
revisions: 1
---

# Partitions

> A topic carries more messages than one machine can handle. How do you spread them out without breaking the order?

## One topic, many partitions

A Kafka topic is not one log. It is split into several parallel logs, each called a partition. Each partition is its own append-only, ordered log numbered by offset.

When a message arrives, the producer decides which partition it goes to: with a key, `hash(key) % number of partitions`. Without a key, older Kafka took turns across partitions; since 2.4 it fills a whole batch into one partition and moves to the next when the batch is full (sticky partitioner). The same key always lands in the same partition.

Partitioning divides "which segment a message lands in", not the individual message. Each message (one order, one event) is one complete record; the partition only decides which pile it goes to. So when consumers read in parallel, they read different whole messages, not fragments of the same one.

Like a supermarket checkout: one register (a single partition) means a long queue; ten registers (ten partitions) check out ten people at once. But one customer and their cart always go through the same register (same key, same partition) and are never split up.

The whole relationship: one topic is split into several partitions, and each [consumer group](chunk://consumer-groups) divides those partitions among the consumers in the group.

```text
Topic "orders" split into 4 partitions (each partition is its own ordered log)

  partition 0: [ m0  m4  m8  ... ]
  partition 1: [ m1  m5  m9  ... ]
  partition 2: [ m2  m6  ...     ]
  partition 3: [ m3  m7  ...     ]

The same topic can be read by several consumer groups, each on its own:

  group "billing"                              group "analytics"
  (one partition goes to one consumer)         (its own offsets, separate from billing)
    consumer A ← partition 0, 1                  consumer X ← partition 0, 1, 2, 3
    consumer B ← partition 2, 3
```

Within one group, partitions are divided among the consumers and nobody reads the same one twice; switch to another group, and the same partitions can be read again from the start.

## A partition sets both order and parallelism

**Order**: strictly ordered within one partition, no global order across partitions. To guarantee the order of a set of messages (say, one user's events), give them the same key so they land in the same partition.

**Parallelism**: within one [consumer group](chunk://consumer-groups), each partition is read by only one consumer at a time. So no matter how many consumers you add, the number that can read at once is capped by the partition count. 10 partitions means at most 10 consumers reading at the same time; the 11th sits idle.

## The cost

The partition count is hard to change. Adding partitions changes the `hash(key) % N` mapping, so the same key lands in a different partition from then on; earlier and later messages sit in two partitions and order can no longer be guaranteed. So estimate enough from the start.

Too many partitions has a cost too: each partition is a set of files, the broker opens more file handles, and both rebalance and end-to-end latency go up.
