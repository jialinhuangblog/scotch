---
title: "Lamport Clock"
slug: lamport-clock
brief: "One counter per node; on receiving a message take max + 1, so causal order shows up in the size of the numbers."
date: 2026-07-20
updated: 2026-10-18
revisions: 2
---

# Lamport Clock

A distributed system cannot decide "which came first" from the wall clock, because every machine's [clock is out of sync](chunk://clocks). A Lamport clock drops time altogether and uses an increasing counter instead.

First, what the counter looks like. Every node holds one integer, starting at 0. It moves in only two situations: the node does something itself (writes a row, sends a message), +1; or it receives a message from someone else, which carries the sender's number at the time, and the node compares that with its own, takes the larger one, and adds 1.

Walk it through with two machines. A does three things in a row, counter 1, 2, 3. The third one is sending a message to B: the send itself is +1, which makes 3, and that 3 is the stamp on the message. Meanwhile B has done two things of its own, counter 1, 2. The message arrives, B looks: theirs 3, mine 2, take 3 and add 1, B's counter jumps to 4.

```text
Node A:  1 → 2 → 3
                    ↘ message carrying 3 goes to B
Node B:        1 → 2 → max(2, 3) + 1 = 4
```

Why take the max instead of just adding 1? If B only added 1 on receipt it would be at 3, the same as A was when it sent. But "B received" clearly happened after "A sent", so the number should be larger. Taking the max folds in the distance the other side has already covered: A is already at 3, B comes after it, so B must be at least 4.

So what the number guarantees is this: whenever event A really influenced event B (A sent a message and B received it, or A came first on the same machine), A's number is always smaller than B's.

The reverse does not hold. B's own second action is 2, A's send is 3, and 2 is smaller than 3, but the two have nothing to do with each other, and asking which came first has no meaning. A smaller counter only says "possibly earlier", not "earlier". To tell whether two events are causally related or concurrent, use a [Vector Clock](chunk://vector-clock).
