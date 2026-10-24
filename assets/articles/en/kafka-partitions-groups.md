---
title: "Is a partition just an offset?"
slug: kafka-partitions-groups
date: 2026-07-12
updated: 2026-10-17
revisions: 1
subtitle: "Does the log get cut into pieces? How many machines read one partition? Can a new group read from the start? Every one of these asks how Kafka arranges order and parallelism."
chapter: "messaging"
tags: [kafka, partition, offset, consumer-group, ordering, system-design]
related: [why-kafka, message-system-axes]
---

# Is a partition just an offset?

[why-kafka](article://why-kafka) covered why Kafka is worth using: messages stay after they are read. So how does a consumer read them? Is the log one single line? When several consumers read together, is the log cut into pieces? What happens to order after the cut? And what is the relation between partition and offset?

---

## If Kafka had only one log

Events for three orders (42, 77, 91) arrive in the order they happened, all queued in one line:

```text
one single log (orders):
  offset 0  {"order_id":42,"status":"created","ts":"10:00:01"}
  offset 1  {"order_id":77,"status":"created","ts":"10:00:02"}
  offset 2  {"order_id":42,"status":"paid",   "ts":"10:00:05"}
  offset 3  {"order_id":91,"status":"created","ts":"10:00:07"}
  offset 4  {"order_id":77,"status":"paid",   "ts":"10:00:09"}
  offset 5  {"order_id":42,"status":"shipped","ts":"10:00:12"}
```

The whole line is globally ordered. One consumer reading from 0 to 5 gets the complete history. But only one machine can read it. Add a second machine to share the work, and reading the same log only reads 0 to 5 a second time. That is not splitting the work.

To split the work, the log has to be cut, and each piece is a [partition](chunk://partitions).

---

## After the cut: partition is which lane, offset is which entry

A topic cut into N lanes has N partitions. The offset is "which entry inside that lane", and each lane numbers its own from 0:

```text
partition 0:
  offset 0  {"order_id":42,"status":"created"}
  offset 1  {"order_id":42,"status":"paid"}
  offset 2  {"order_id":42,"status":"shipped"}
partition 1:
  offset 0  {"order_id":77,"status":"created"}
  offset 1  {"order_id":77,"status":"paid"}
partition 2:
  offset 0  {"order_id":91,"status":"created"}
```

So a partition is not an offset. The partition is which book, the offset is which page of that book: every book has a page 1, and "page 1" alone points at nothing. The full address of one message is the pair (partition, offset). Offset 1 in p0 is 42's paid, offset 1 in p1 is 77's paid, different messages.

In the diagram above, all three entries for 42 are in p0 because the writes carried key=42. They line up created→paid→shipped because one partition appends in write order.

---

## A message arrives; what decides which lane it goes to

A producer can attach a key when sending. With a key, hash(key) decides where it lands, and the same key always goes to the same lane. Without a key, the partitioner on the producer side assigns it, with no guarantee about which lane related messages land in.

**Order does not matter → no key, spread evenly.** The click events (`click-events`) in the [URL shortener demo](article://url-shortener-demo) are this kind: every entry is independent and at the end they are only summed. Three clicks arrive, no key, so the producer assigns them:

```text
10:00:01  {"short_key":"abc123"}  → goes to p0, becomes p0's offset 0
10:00:02  {"short_key":"xyz789"}  → goes to p1, becomes p1's offset 0
10:00:03  {"short_key":"abc123"}  → goes to p0, becomes p0's offset 1

after landing:
  p0:  [offset 0] abc123   [offset 1] abc123
  p1:  [offset 0] xyz789
```

The two `abc123` entries happened to both land in p0 this time. Next time one could be in p0 and the other in p1. There is no guarantee, because no key was given. Scattered order does not matter, because only the total is counted, and who came first does not change the result. The demo's `WriteMessages` passes no Key, and that is this case. The partition count depends purely on throughput: when one machine cannot keep up, cut more.

**Order needed within one entity → key = entity id.** The most common case. An order's created→paid→shipped must not be scrambled, and different orders are unrelated:

```text
key=42 arrives, hash(42) → always p0; key=77, hash(77) → always p1:
  p0:  [offset 0] 42 created   [offset 1] 42 paid   [offset 2] 42 shipped
  p1:  [offset 0] 77 created
```

What happens without a key: `42 created` is thrown into p0 and `42 paid` into p1, and order exists only inside a single partition. There is no coordination at all between partitions. Say p0 has a backlog of 8000 entries ahead and p1 is empty:

```text
10:00:01  42 created → p0 (8000 entries backlogged ahead of it)
10:00:05  42 paid    → p1 (empty)

on p1, paid is read at 10:00:06
on p0, created is read at 10:03, after the backlog is worked through
```

Downstream receives paid first and created second, which amounts to paying for an order that does not exist yet. The state machine gets an invalid state transition. And this does not need two consumers to happen; one machine reading p0 plus p1 behaves the same. It pulls from the two lines separately, and whichever has no backlog is pulled first. The key puts everything for one order into the same line, the queue is first in first out, and only then does order exist.

**Everything must be ordered → only 1 partition.** A ledger where every entry depends on the one before can only be one line to the end. The cost is a single reader forever, so throughput is capped at one machine.

**Wrong key → hot spot.**

```text
key = country:
  p0 (TW): ██████████████████  90% of traffic
  p1 (JP): ██
  p2 (US): █
```

The machine assigned p0 is saturated while the other two sit idle. Pick a key column whose values are spread widely: order_id has millions of values and spreads evenly; country has only three values, TW takes nine tenths of the traffic, and all of it lands in p0.

---

## Inside one group, who reads which lane

The unit of reading is **a whole partition**, not entries handed out one at a time in turn:

```text
group "analytics", topic with 2 partitions:
  partition 0 ──whole──► consumer X
  partition 1 ──whole──► consumer Y
```

X only touches p0, Y only touches p1, and each moves the offset forward on its own line. The relation between consumer count and partition count:

```text
fewer consumers than partitions   1 machine, 2 lines → one machine reads p0 plus p1 by itself
exactly equal                     2 machines, 2 lines → one line each
more consumers than partitions    3 machines, 2 lines → the third machine sits idle
```

The third machine sits idle because **the parallelism ceiling inside one group is the partition count**. Extra consumers only stand by. To go faster, add partitions, not consumers.

The actual read (the demo's consumer, Go):

```go
r := kafka.NewReader(kafka.ReaderConfig{
    Topic:   "click-events",
    GroupID: "analytics-consumer",
})
for {
    msg, _ := r.ReadMessage(ctx)
    // msg.Partition  which lane
    // msg.Offset     which entry in that line
    // msg.Value      JSON bytes
}
```

After reading, the consumer commits the position it reached (the committed offset, called the bookmark below) back to Kafka: "(analytics-consumer, p0) read up to 2". The bookmark is bound to the pair (group, partition). After a crash and restart, or when another machine takes over this partition, the bookmark says which entry to continue from (the [consumer groups](chunk://consumer-groups) chunk has the rebalance details).

---

## Can a new group read from the start

"One partition goes to one consumer" holds only **inside one group**. Across groups, the same partition can be read by several groups at the same time:

```text
partition 0 ─┬─► consumer X in group analytics (bookmark 500)
             └─► consumer M in group billing   (bookmark 20)
```

X and M both read p0 without interfering, because each keeps its own bookmark. The two rules side by side:

```text
inside a group  →  split the work: partitions divided up, one lane per machine, one entry processed once by this group
across groups   →  broadcast: every group reads on its own; where a new group starts is set by the client's auto.offset.reset
```

So whether a new group reads from the start depends on the client's default. The demo above uses kafka-go, where `StartOffset` defaults to `FirstOffset`, so a new group reads from the first record. With the Java client, `auto.offset.reset` defaults to `latest`: a new group only sees messages written after it joined, and none of the old ones. To read from the start, set it to `earliest` explicitly.

The "feed one set of data to several downstreams" in [why-kafka](article://why-kafka) is this mechanism: one group per downstream.

---

## Three settings

```text
key              → who must queue behind whom (the scope of ordering)
partition count  → at most how many machines work at once inside one group (the parallelism ceiling)
group count      → how many downstreams this data feeds (a complete copy per group)
```
