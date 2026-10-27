---
title: "Edge vs Level Triggered"
slug: edge-vs-level-triggered
brief: "Edge catches the moment of a transition, level reads the current state; miss one and level still reads the same state next time, while the edge transition has passed and will not notify again."
date: 2026-07-20
---

# Edge-triggered vs Level-triggered

Both terms come from digital circuits. The voltage on a wire jumps between low (0) and high (1); drawn out, it is a square wave:

```
        ┌────────┐        ┌────
        │        │        │
────────┘        └────────┘
        ↑        ↑
   rising edge  falling edge
```

Level is where the signal sits right now, high or low. Edge is the moment the signal changes, low to high or high to low. On the same wire, asking "is it high right now" is level; asking "did it just jump up" is edge.

Hardware reacts to signals in these two ways too. Level-triggered keeps reacting as long as the signal stays at a given level. Edge-triggered reacts once, at the moment of the change, then stays quiet however long the signal holds, until the next change.

An edge happens once; miss that instant and it is gone forever. Level has no such problem: miss it this time, read it next time; as long as the level is still there it can be read. A common frontend example: `addEventListener('click')` is edge (fires once at the moment it happens), CSS `:hover` is level (holds true for as long as the mouse stays).

If the k8s controller were edge-triggered, it would subscribe to a "Pod died" event and react when it arrives. If the controller was down at that moment or the message was lost, that edge is missed and the Pod never gets recreated. k8s chose level-triggered: every round of the [reconciliation](chunk://reconciliation) loop reads the current state and compares desired against actual. It asks "how many Pods actually exist right now", not "what just happened", so missing any single observation does not matter; the next round rereads the whole state and catches up on its own.

The cost is that the controller has to read state and compare every round, which is more work than waiting for an event notification. But in a distributed system messages will be lost, so trading efficiency for "recovers on its own even after a miss" is worth it.
