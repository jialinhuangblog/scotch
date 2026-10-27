---
title: "Choosing a Queue"
slug: message-queue-comparison
brief: "Kafka, RabbitMQ, and SQS are designed differently underneath; pick the wrong one and it is hard to switch later."
date: 2026-03-28
updated: 2026-07-20
revisions: 4
article: message-system-axes
---

## How they differ

| Tool | Pattern | After a message is consumed | Good for |
|---|---|---|---|
| Kafka | Pub/Sub + Fan-out | Kept (per retention) | Event streaming, replay, many consumers |
| RabbitMQ | Point-to-Point / Pub/Sub | Deleted | Task dispatch, work queue |
| SQS | Point-to-Point | Deleted | AWS ecosystem, competing consumers |
| SNS | Pub/Sub + Fan-out | — | One publish, many receivers, often paired with SQS |
| Redis pub/sub | Pub/Sub | Not stored (dropped once sent) | Low latency; dropped if the subscriber is offline |
| MQTT (protocol, with Mosquitto/EMQX) | Pub/Sub | Depends on config (can retain) | IoT, low-bandwidth devices |

## How to choose

**Need replay** (a consumer crashed and has to catch up, or several consumers each read on their own) → Kafka. Messages are a log; reading does not delete them.

**Need each task handled once** (job queue, sending email) → RabbitMQ or SQS. The broker deletes the message only after the consumer acks, so in the normal case it goes to one worker. But an SQS standard queue still redelivers the same message now and then, so the worker still has to be idempotent.

**Inside the AWS ecosystem** → SQS (queue) + SNS (broadcast). Managed service, no broker to maintain.

**Low latency, dropping is fine** (live notifications, live feed) → Redis pub/sub. Messages for an offline subscriber are dropped outright, nothing is persisted.

## Common misunderstandings

Kafka is built on an append-only log, which is easy to confuse with "logging" (recording system events). They are different things: Kafka is a messaging broker, logging is a debugging tool.

**MQTT is a protocol, not a broker.** MQTT only defines how messages are sent and received; to actually move messages you pair it with a broker such as Mosquitto or EMQX. Every other row in the table is a product; MQTT is in the comparison as the combination "protocol + broker".

**"Dropped" in pub/sub does not mean deleted once someone takes it.** A queue (point-to-point) deletes only after the consumer acks; pub/sub has the broker copy the message to every online subscriber and keep nothing once it is sent. One subscriber receiving it does not affect the others; anyone offline at publish time misses it for good.
