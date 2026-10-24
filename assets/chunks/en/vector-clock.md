---
title: "Vector Clock"
slug: vector-clock
brief: "Every node keeps a vector of all nodes' counters, which tells a causal relationship apart from concurrent."
date: 2026-07-20
updated: 2026-10-18
revisions: 2
---

# Vector Clock

A [Lamport clock](chunk://lamport-clock) keeps one number per node, so given two numbers you cannot tell whether the two events happened one after the other or independently. A vector clock makes each node keep a row of numbers instead, one slot per node.

Three nodes A, B and C, each starting with [A:0, B:0, C:0]. When a node does something, it adds 1 to its own slot. Sending a message counts as doing something, so the node first adds 1 to its own slot, then attaches the updated row. When it receives one, it takes the maximum of each slot across both rows, then adds 1 to its own slot.

Same order system. A places the order, B deducts stock, C computes recommendations, and C has nothing to do with this order.

```text
A places the order                                    A: [A:1, B:0, C:0]
A sends a message to B, adds 1 to A, attaches row    A: [A:2, B:0, C:0]
B receives it, max per slot, then adds 1 to B         B: [A:2, B:1, C:0]
B deducts stock                                       B: [A:2, B:2, C:0]
C computes recommendations, talks to nobody           C: [A:0, B:0, C:1]
```

Compare the rows. A's order is [1,0,0] and B's deduction is [2,2,0]; every slot of the first is ≤ the same slot of the second, so the order happened before the deduction. B's deduction [2,2,0] against C's recommendation [0,0,1] is different: B's row is bigger in the A slot, C's row is bigger in the C slot, neither contains the other, so the two events are concurrent and neither comes before the other. Run the same situation with a Lamport clock: A's order is 1 and its send is 2; B's receipt is max(0, 2) + 1 = 3 and its deduction is 4; C's recommendation is 1. B gets 4 and C gets 1, which looks as if C came first, when the two are unrelated.

In a database, concurrent looks like this: the same key was changed on two nodes, each producing its own version, and the two vectors do not contain each other. The system cannot pick one by itself. It either keeps both versions and hands them to the application to merge, or picks one by a fixed rule. Amazon's 2007 Dynamo paper used this scheme. The later DynamoDB service works differently. Each partition has one leader that takes all writes, so inside a single region the same key is never changed into two versions on two nodes. Two versions only appear in cross-region global tables, and in the eventually consistent (MREC) mode DynamoDB resolves them with last writer wins, keeping the version with the latest internal timestamp.

The cost is the vector itself. The vector lists the nodes that changed this record, so the more nodes change it, the longer it gets; the total size of the cluster does not matter. In Dynamo a record is normally handled by the first N nodes of its preference list, and the common setting in the paper is N = 3, so a vector usually has only a few slots. It grows only when network partitions or several failed servers make other nodes take the writes. The paper caps it: once the vector reaches 10 slots, the oldest slot is dropped. After that, some versions can no longer be ordered.
