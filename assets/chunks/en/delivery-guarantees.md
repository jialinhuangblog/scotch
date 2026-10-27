---
title: "Delivery Guarantees (Three Delivery Semantics)"
slug: delivery-guarantees
brief: "at-most / at-least / exactly-once are not categories of systems but settings every one of them can tune: wait for an ack or not, resend or not, make the consumer idempotent or not."
date: 2026-07-12
updated: 2026-10-19
revisions: 3
article: message-system-axes
---

# Delivery Guarantees (Three Delivery Semantics)

> A message is sent. Can it get lost? Can it arrive twice?

## Three levels

Walk the same scene three times. The order service sends "order 42 has shipped" to the notification service, which pushes one app notification to the user on receipt. Somewhere in between, the network drops one packet.

**at most once.** The order service sends and moves on, without waiting for an ack. If the dropped packet is the message itself, the notification service never receives it, the user gets no notification, and the message is lost. The upside is speed: send it and do the next thing right away.

**at least once.** The order service sends, waits for an ack, and resends after one second without one. If the message was dropped, the resend fills the gap and nothing is lost. But if the ack was dropped, the notification service did receive it and did push the notification; only the reply never arrived. The order service assumes it was not received and sends again, and the user gets two identical notifications. Nothing is lost, but it duplicates.

**exactly once.** Nothing is lost, and the user gets only one notification. The message can still arrive twice over the network, so the way to get there is at-least-once plus dedup on the receiving side: handling the message and recording "this one is done" must succeed together or count as not done together. Only then can a resend be recognized and discarded. The most expensive, with the most constraints.

The most common form of dedup is the consumer's [idempotency](chunk://idempotency): the notification service looks up the key "order 42 shipped", sees it already pushed, and skips, so the second notification never goes out. But "check whether it was pushed", "push the notification" and "record that it was pushed" are three separate steps. If the service crashes after pushing and before recording the key, the resend finds no key, and the user still gets two notifications. To avoid that duplicate, "push the notification" and "record the key" would have to succeed together or count as not done together, but the push service sits outside the system, and the two steps cannot go into one transaction. So this example reaches "no duplicates except at the moment of a crash", which is not yet exactly once. True [exactly-once](chunk://exactly-once) needs the result and the "already handled" record written to the same place, bound into one transaction. Kafka→Kafka with transactions does this. Writing results to an external DB can do it too: the consumer writes the result and the offset it read into one DB transaction, and reads the offset back from the DB on restart, which is what Kafka's consumer docs recommend. An external API cannot: the push service here cannot share a transaction with the offset, so it falls back to at-least-once plus idempotency.

## One system can be tuned to different levels

On a single MQTT broker, each message picks its own QoS:

```text
QoS 0  send and forget            → at most once
QoS 1  resend until PUBACK        → at least once (may duplicate)
QoS 2  four step handshake        → exactly once (most expensive)
```

Other systems are tunable the same way: RabbitMQ's publisher confirm plus consumer ack mode, Kafka's `acks` plus the timing of the offset commit. So delivery guarantees do not place a system in a category; pub/sub and queues can both be configured to any level. To place a system, look at the axes in [choosing a message system](article://message-system-axes). The delivery guarantee is a separate question asked during that choice.


The three levels are a tradeoff between loss and duplication: skip the ack and messages get lost, resend and they duplicate, idempotency removes the duplicates. To have no duplicate even at the moment of a crash, the handling and the record must sit in the same transaction.
