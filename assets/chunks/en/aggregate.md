---
title: "Aggregate Root"
slug: aggregate
brief: "An aggregate is a group of entities that guards an invariant. With no invariant to guard, you do not need one."
article: ddd-textbook-vs-real
date: 2026-06-14
---

# Aggregate Root

Draw a circle around a few related entities and make one root the only entrance from outside. The purpose is to guard an **invariant**: a rule that must always hold, one the data may never break at any moment (for example "an order has at most 100 line items", "a paid order cannot be changed").

This is the most disputed of the eight DDD rules. The dispute is over **whether to use it** and **how large to draw the boundary**. Most entity relationships have no hard invariant at all, and forcing them into an aggregate only adds complexity. Draw the boundary too large and changing one small field means loading the whole aggregate, with more lock contention too; draw it too small and the invariant it should guard goes unguarded.

## The textbook definition

One entity stands for the group toward the outside. Every change to a child entity must **go through the root**; nothing touches a child directly.

The classic example: Order + LineItem

```typescript
class Order {
  private items: LineItem[] = [];

  addItem(item: LineItem): void {
    if (this.items.length >= 100) throw new Error('order full');
    if (this.status === 'paid') throw new Error('cannot modify paid order');
    this.items.push(item);
  }
  // outside code cannot call LineItem.persist() directly
}
```

`Order` is the aggregate root, `LineItem` is the child. Adding a LineItem must go through `order.addItem()`, which is what keeps invariants like "at most 100 items" and "paid orders cannot change" intact.

## Why it is often skipped in practice

An aggregate's value comes from the **invariant**. Without one, building an aggregate is pure ceremony:

- More code complexity
- One more layer of abstraction between entities
- A more restricted repository API

Many entity pairs **have no strong invariant at all**, for example Conversation + Message. Then let the two stay independent, each with its own repository.

Vaughn Vernon's [Effective Aggregate Design](https://www.dddcommunity.org/library/vernon_2011/) argues that aggregates should be small: large cluster aggregates perform and scale poorly, and the boundary should follow the real consistency constraints of the business, not the object relationship graph or whatever is convenient.

## How to decide

**Is there an invariant across entities that must be guarded together?**

- Yes ("at most 100 items", "the sum cannot exceed X", "mutually exclusive states") → build an aggregate
- No → do not; flat entities are enough

If you skip it, an ADR (Architecture Decision Record) can record the reason.

---

## References

- [Effective Aggregate Design](https://www.dddcommunity.org/library/vernon_2011/) — Vaughn Vernon, 2011. The classic argument for small aggregates drawn around real invariants.
