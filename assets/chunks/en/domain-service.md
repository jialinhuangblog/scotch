---
title: "Domain Service"
slug: domain-service
brief: "A pure business rule that spans several entities, belongs to none of them, and touches no I/O."
date: 2026-06-14
article: ddd-textbook-vs-real
---

# Domain Service

Some business rules involve several entities, and putting them inside any one of them does not fit. Those rules go in a Domain Service: a stateless, zero I/O (no DB, no network) pure business function.

## When to use it

Two conditions: **spans several entities** + **only computes, no I/O**.

E-commerce examples:

- **Shipping fee**: depends on weight, destination, and the carrier's rate rules. It fits in neither `Order` nor `Customer`, so it gets its own `ShippingFeeService`.
- **Whether an order qualifies for a promotion**: needs `Order`, `Promotion`, and `Customer` at the same time.

Take the shipping fee. It only computes and returns a result, without touching the DB:

```typescript
// domain/services/shipping-fee-service.ts (compute only, no DB or network)
export class ShippingFeeService {
  calc(cart: Cart, dest: Address): Money {
    const weight = cart.totalWeight();                       // uses the entity passed in, never fetches on its own
    const base   = weight <= 5 ? 60 : 60 + (weight - 5) * 12; // weight tiers
    const remote = dest.isRemoteArea() ? 100 : 0;            // remote area surcharge
    if (cart.subtotal() >= 1000) return Money.zero();        // free shipping over 1000
    return Money.of(base + remote);
  }
}
```

`cart` is passed in after the application service has queried it; the service does not query the DB itself. It returns `Money` when done; whether to store it is for the application service to decide by calling a repository. Its only job is the shipping fee rule.

## Keep it apart from the other two layers

The one it is most easily confused with is the [Application Service](chunk://application-service).

| | Responsible for | Touches I/O? |
|---|---|---|
| entity method | one entity's behavior (`order.addItem()`) | no |
| **Domain Service** | pure business rules across entities | **no** |
| Application Service | fetching data, orchestrating, saving back | yes |

Of the three layers only the Application Service touches I/O. The Domain Service only computes; saving and fetching data are left to the Application Service.

Like an accountant computing tax: given the numbers, apply the rules and produce the answer, but not responsible for digging receipts out of the warehouse, nor for saving the result into the system.
