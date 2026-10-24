---
title: "Domain Event"
slug: domain-event
brief: "Something happened in the business, so publish an event; whoever cares reacts on their own, and the publisher does not need to know who is listening."
date: 2026-06-14
article: ddd-textbook-vs-real
---

# Domain Event

Something meaningful happened in the business (an order was placed, a payment came through, a shipment was delivered). Broadcast it as an event. Downstream parties that care about it subscribe and handle it themselves. **The code that triggered it does not need to know who is listening.**

Names are in the past tense: `OrderPlaced`, `PaymentReceived`, `ShipmentDelivered`, to stress that it has already happened.

## What it solves

Without events, the code that runs after a successful order has to call everything itself: deduct stock, send the email, record analytics... Every new downstream step means going back to change the ordering code.

With events, placing an order only has to publish one `OrderPlaced`:

```text
order placed → publish OrderPlaced
                 ├→ inventory service: deduct stock
                 ├→ notification service: send the confirmation email
                 └→ analytics service: record one entry
```

The ordering code never knows these three downstream parties exist. Adding a fourth one does not touch the ordering code either.

It is like pinning a notice on a bulletin board: "an order was created". Whoever cares comes to read it and handles it themselves. The person who pinned the notice does not have to phone everyone one by one.

## Domain Event is not Event Sourcing

Domain Events are often wired to a [message queue](chunk://message-queue-comparison) and an event-driven architecture (events go into Kafka, other services subscribe). But turning every state change into an event and adopting Event Sourcing without a good reason is overengineering, and a widely recognized anti-pattern.
