---
title: "RabbitMQ Exchange"
slug: exchange
brief: "The producer does not write to a queue directly; it hands the message to an exchange, and the exchange uses binding rules to decide which queues it goes into."
date: 2026-07-12
updated: 2026-10-17
revisions: 2
article: rabbitmq-routing
---

# RabbitMQ Exchange

> A producer wants to publish a message, but which queues should receive it is a rule that keeps changing. How do you keep the producer from having to know these queues?

## One more routing layer in between

A Kafka producer writes straight into a topic. An SQS producer sends straight into a queue. A RabbitMQ producer hands the message to an exchange, and the exchange decides by rule which queues it goes into. Possibly none.

A queue first has to be bound to the exchange with a binding, and the binding carries a condition. Walk one message through. The exchange is called `orders`, its type is topic, and three bindings hang on it:

```text
binding 1  order.*.paid       → queue: invoice
binding 2  order.us.#         → queue: us-analytics
binding 3  order.*.cancelled  → queue: refund
```

The producer publishes a message with routing key `order.us.paid` to `orders`. The exchange checks the bindings one by one. In binding 1 the `*` matches `us`, so invoice gets a copy. In binding 2 the `#` matches `paid`, so us-analytics gets a copy too. Binding 3 wants `cancelled` and does not match. One message is copied twice and lands in two queues. The producer knows only the name `orders`; it does not know there are three bindings behind it, or that this message turns into two copies.

## The three exchange types you will use (a fourth, headers, is rare)

- **fanout**: ignores conditions and copies every incoming message to all bound queues. Use it to broadcast; the effect is the same as SNS's one publish, many receivers.
- **direct**: the message carries a routing key, the binding carries a key too, and the message is delivered only when the two strings are exactly equal. Use it for exact splitting, for example logs with `severity=error` go only into the error queue.
- **topic**: the routing key is a string split by dots, and the binding can match with wildcards: `*` matches one segment, `#` matches zero or more. The example above is this kind. Use it to subscribe to a whole class of events by pattern. This is RabbitMQ's most flexible kind.

## Why this layer is useful

The routing rules live on the exchange and the bindings, not in the producer. If tomorrow a new queue wants `order.*.paid` for fraud detection, add a fourth binding and you are done. Not a single line of the producer changes, and the next `order.us.paid` becomes three copies.
