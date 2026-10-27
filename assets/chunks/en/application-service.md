---
title: "Application Service"
slug: application-service
brief: "The entry point and conductor of one use case: it decides what happens first and what next, and strings domain logic, repositories and events into one complete operation, without holding business rules itself."
date: 2026-06-14
article: ddd-textbook-vs-real
---

# Application Service

The entry point of one use case (for example "place an order"). It **orchestrates** one complete operation but **holds no business rules itself**. The rules live in entities and the [Domain Service](chunk://domain-service); it only strings them together and adds the I/O.

## What placing an order looks like

```text
PlaceOrderService.execute(cmd):
  cart  = cartRepo.getById(cmd.cartId)       // read (I/O)
  fee   = shippingFeeService.calc(cart)      // call domain logic (pure calculation, no I/O)
  order = Order.create(cart, fee)            // entity behavior
  orderRepo.save(order)                      // save (I/O)
  events.publish(new OrderPlaced(order.id))  // publish event
```

The I/O it does (reading and writing data, publishing events) exists everywhere, but it alone **knows how this use case runs**: what to read first, which domain logic to call, when to save, which event to publish at the end, and that the whole sequence counts as one transaction. Business rules live in the domain service and entities, persistence in the repository, but "placing an order = these steps, in this order" is known only here. Without it, no layer remembers that order, and each caller has to assemble it by hand.

## Keeping it apart from the Domain Service

These two are the easiest to confuse:

- [Domain Service](chunk://domain-service): **pure business rules, zero I/O**.
- **Application Service**: **orchestration + I/O, zero business rules**.

Like an orchestra: the Application Service is the conductor, who plays no instrument but decides who comes in first, who comes in next, and how the whole piece runs. The [Domain Service](chunk://domain-service) is a musician, responsible only for playing its own part well, not for the overall arrangement.
