---
title: "Consumer Groups"
slug: consumer-groups
brief: "A group of consumers splits the reading of one topic. Which partition goes to whom, and how far each partition has been read, are two different things."
date: 2026-06-12
updated: 2026-07-12
revisions: 2
article: message-system-axes
---

# Consumer Groups

> A topic takes in tens of thousands of messages per second. One consumer cannot keep up. How do several machines read it together without duplicates?

## A group of consumers splits one topic

A consumer group is a set of consumers reading the same topic together. The rule within the group: one [partition](chunk://partitions) is read by only one consumer at a time.

So adding consumers means handing the partitions to more workers, but the parallelism caps at the partition count: with 10 partitions, 10 consumers get exactly one each, and an 11th just sits idle.

```text
topic (4 partitions)           consumer group "billing"
  partition 0  ───────────────►  consumer A
  partition 1  ───────────────►  consumer A
  partition 2  ───────────────►  consumer B
  partition 3  ───────────────►  consumer B
```

Using the checkout counter analogy from [partitions](chunk://partitions): a partition is a checkout counter, a consumer is the cashier standing behind it, and a consumer group is all the cashiers on the same shift, whose job is to check out every customer at every counter. One counter is staffed by one cashier at a time; more cashiers than counters means someone stands idle.

## Assignment and offset are two different things

**Assignment**: which partition belongs to which consumer. The diagram above is the assignment: A handles 0 and 1, B handles 2 and 3. This is the division of work within the group (load balancing). It is fairly stable and only changes when someone joins or leaves (see rebalance below). A consumer assigned several partitions reads them in parallel at the same time, not one after another.

**Offset**: within one partition, how many messages have been read. Each partition is its own log numbered 0, 1, 2, 3... and the offset is the bookmark on that log, pointing at "the next number to read".

So the offset does not record "which partition I am on". It records "how far into a given partition I am".

## The offset is bound to (group, partition)

An offset is "how far a given group has read in a given partition", stored in Kafka's own `__consumer_offsets`.

```text
partition 0:  [#0][#1][#2][#3][#4][#5] ...
                          ↑ billing's offset on p0 = 3 (next read is #3)
```

Because the bookmark is bound to the (group, partition) pair, when a consumer crashes and restarts, or another machine takes over, it reads the bookmark and knows which number to continue from. It neither starts over nor skips.

Back to the counters: the offset is the "served up to customer number N" marker on each counter. When the shift changes, the new cashier reads the marker and knows which customer to serve next.

## Different groups each read their own

Messages do not disappear once read. Each group has its own full set of offsets, and they do not affect each other: on the same topic, the billing group reads from the start to do the accounting, and the analytics group also reads from the start to build reports. Each tracks its own progress. This is how Kafka lets one copy of the data serve several downstream consumers.

So there are two levels: across groups, each reads the whole thing (fan out); within a group, the partitions are split up (division of work).

## Rebalance

When a consumer joins or leaves, the partitions are reassigned within the group. Reading pauses briefly during this; it is called a rebalance. The consumer that takes over continues from that partition's existing offset, not from the start. A consumer count that changes often keeps triggering rebalances, a common performance problem.
