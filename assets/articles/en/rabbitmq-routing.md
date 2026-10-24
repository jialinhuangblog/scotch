---
title: "SQS can send and receive messages too. Why add RabbitMQ?"
slug: rabbitmq-routing
date: 2026-07-12
subtitle: "RabbitMQ deletes messages just like SQS. The difference is an extra exchange layer between the producer and the queues, so the producer never has to know which queues exist."
chapter: "messaging"
tags: [rabbitmq, exchange, routing, amqp, message-queue, system-design]
related: [message-system-axes, sns-sqs, why-kafka, queue-peak-shaving]
---

# SQS can send and receive messages too. Why add RabbitMQ?

[SNS+SQS](article://sns-sqs) already decouples, already absorbs peaks, already has a DLQ. Everything that should be there is there. RabbitMQ is also in the delete-the-message camp, so it looks like it does the same job. What does it add?

On the four questions ([which four](article://message-system-axes)), RabbitMQ's delivery can be point-to-point or pub/sub, its layer is the backend, and its storage is delete once acked. On every one of these it sits on the same side as SQS, opposite to [Kafka's "keep"](article://why-kafka). What RabbitMQ adds is an [exchange](chunk://exchange) layer: the producer does not write to a queue directly. This layer sits in between.

What that layer buys is routing flexibility: which message goes into which queues becomes a rule you can change at any time, written on the broker, not in the producer.

---

## The producer does not know which queue is which

An SQS producer has to name the queue it sends to. A Kafka producer has to name the topic it writes to. Both producers have to know what the downstream looks like.

A RabbitMQ producer does not need to know the downstream. The producer hands the message to an exchange with a routing key attached, and then forgets about it. On the other side, each queue binds itself to the exchange with a binding, and the binding carries the condition "this is what I want to receive". A message enters the exchange, gets checked against every binding, and each matching queue receives a copy.

In SQS the producer knows the queue. In RabbitMQ the queue knows the exchange, and the producer knows no queue at all. Want one more downstream? Add a binding on the exchange. Not one line of the producer changes.

```python
# the queue binds itself to the exchange, with the condition for what it wants to receive
channel.exchange_declare('orders', 'topic')
channel.queue_bind(queue='payments', exchange='orders', routing_key='order.*.paid')

# the producer only hands off to the exchange and knows no queue
channel.basic_publish(exchange='orders', routing_key='order.us.paid', body=msg)
```

---

## Three exchange types are three routing rules

There are three commonly used exchange types ([exchange](chunk://exchange)), and each one is a routing rule. There is also a headers exchange that matches on message headers, but it is rarely used:

- **fanout**: no condition. Every queue bound to it gets a copy. This is [SNS's one send, many receivers](article://sns-sqs), and RabbitMQ has the same ability built in.
- **direct**: deliver only when the routing key matches exactly. `severity=error` goes into the error queue only. Precise splitting.
- **topic**: the routing key is split by dots, and the binding can use wildcards. `order.*.paid` receives payment events from every region, `order.#` receives everything about orders.

SNS is basically fanout. A subscription can set a filter policy that filters on message attributes or JSON content, but there is no wildcard matching on a routing key. Kafka splits traffic with topics plus partitions. RabbitMQ puts all three in one broker, and direct and topic, the two that route by routing key, are where it differs most from the other two.

---

## The broker pushes, prefetch limits the flow

Push and pull differ too. In Kafka and SQS the consumer goes and pulls messages itself. In RabbitMQ the broker pushes messages to the consumer.

If the broker pushes too many at once, the messages the consumer cannot finish pile up in its memory. RabbitMQ handles this with prefetch: set the maximum number of unacked messages one consumer can hold. At that limit the broker stops, and waits for a few acks before pushing again. This is the flow control the push model has to add for itself.

As for splitting the work, it goes the same way as SQS: several consumers bound to the same queue are competing consumers, and each message goes to only one. A message that fails and retries over and over goes into the [DLQ](chunk://dlq) to be isolated, same as before.

---

## Choosing among the three

- Complex routing rules, splitting by content, topic patterns, priority queues → RabbitMQ. That exchange layer is unique to it.
- Just "one send, many receivers" plus a managed service, inside the AWS ecosystem, no wish to run a broker yourself → [SNS+SQS](article://sns-sqs) costs less.
- Replay, several downstreams each reading the same data from the start, the source of truth for events → [Kafka](article://why-kafka). All of these need the messages to stay.
