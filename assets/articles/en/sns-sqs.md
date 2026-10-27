---
title: "Sending one notification: why use both SNS and SQS?"
slug: sns-sqs
date: 2026-07-12
subtitle: "Neither SNS nor SQS keeps messages, the opposite of Kafka. Why does putting the two together decouple producers from consumers?"
chapter: "messaging"
tags: [sqs, sns, aws, decoupling, dlq, system-design]
related: [message-system-axes, why-kafka, rabbitmq-routing, queue-peak-shaving, url-shortener-demo]
---

# Sending one notification: why use both SNS and SQS?

An order is placed, and three services need to know: payment, inventory, email. The standard way on AWS is SNS plus SQS: SNS sends, SQS receives, with one more layer in between. A single broadcast would cover it, so why two services?

Where they sit on the four questions ([which four](article://message-system-axes)): SNS is pub/sub, push, backend. SQS is point-to-point, pull, backend. On storage, neither keeps anything. SQS deletes a message once it is acked, and SNS keeps nothing after delivery, the exact opposite of [Kafka's "keep"](article://why-kafka). So why pair up two services that both throw messages away?

For decoupling. The sender does not need to know who is receiving, whether they can keep up, or whether they are down.

---

## Why not have SNS push to the services directly

SNS can push by itself. It can POST a message straight to an HTTP endpoint: the payment service exposes a URL, SNS subscribes it, and the message arrives. So why wedge an SQS in the middle?

Because SNS does not hold messages for its subscribers (consistent with [the definition of pub/sub](chunk://message-queue-comparison)). When a push to an HTTP endpoint fails, it retries a few times according to the delivery policy, and once the retries are used up it drops the message, unless that subscription has its own dead-letter queue (DLQ, covered below). If the payment service happens to be restarting, and the restart takes longer than the retry window, that message is gone. Or Black Friday traffic pours in, SNS pushes three thousand messages a second, the service cannot handle three thousand a second, and it falls over.

An SQS in the middle solves both problems. SNS publishes once and a copy goes into each service's own SQS queue. Each service pulls from its queue at its own pace, one message at a time. If the service is down, the messages wait in the queue until it comes back. If traffic spikes, the messages sit in the queue first and the service works through them at its own speed (this is [peak shaving](article://queue-peak-shaving)).

So SNS does the broadcasting and SQS does the buffering. The sender calls SNS publish once, and each service reads from its own queue.

```bash
# SNS publishes once; every subscribed SQS queue gets a copy
aws sns publish --topic-arn arn:aws:sns:...:orders --message '{"orderId":123}'

# each service polls its own queue and deletes only after processing
aws sqs receive-message --queue-url https://sqs.../billing-queue
aws sqs delete-message  --queue-url https://sqs.../billing-queue --receipt-handle <handle>
```

---

## One queue, several workers competing

One payment server cannot keep up, so three of them pull from the same queue together. This is called competing consumers: a message goes to only one of the three, and the three split the work.

"One message, one worker" is also what [a Kafka consumer group](chunk://consumer-groups) does internally: consumers in the same group split the messages, and each one goes to only one of them.

Getting a complete copy to a second downstream is where the two differ. In Kafka, open a new consumer group and read the same log again from the start. In SQS, one queue is one endpoint, and getting everything to a second downstream means having SNS fan out to a second queue. So the number of queues matches "how many downstream services", and the number of workers under one queue matches "how many machines this service needs to share the load". The two numbers mean different things.

Once one worker has pulled a message, the others do not get it again. The mechanism is the [visibility timeout](chunk://sqs-visibility). The message is not deleted right away. It is hidden for a period, and during that period no other worker can see it. When processing is done, the worker calls delete to remove it. If the worker dies halfway and never deletes it, the message becomes visible again after the timeout, and another worker takes over.

The cost is that this only guarantees at-least-once: if the worker finishes processing and dies before it can delete, the message is pulled again after the timeout. So the consumer side has to handle duplicates, usually through [idempotency](chunk://idempotency).

---

## What about the message that keeps failing

One message has a broken format. Every time a worker receives it, processing fails and it is not deleted. After the timeout it becomes visible again, gets received again, fails again. This poison message retries over and over, and every retry wastes one round of worker time. A standard queue does not guarantee order, so other messages still get through. A FIFO queue is different: the healthy messages queued behind it in the same message group wait until it is deleted before they are sent, so the whole group stalls.

The fix is a [dead-letter queue (DLQ)](chunk://dlq). Set a retry limit, say five failures for the same message, and SQS moves it into a separate dedicated queue to isolate it. The main queue stops retrying it. The bad message stays in the DLQ, and someone pulls it out later to see what went wrong.

---

## Everything is deleted, so no catching up on history

SQS deletes a message once it is acked, and that brings a limit Kafka does not have: a new service goes live today and wants the last three months of order events. It cannot get them. Those messages were gone the moment they were processed.

This is the other side of the trade in [why-kafka](article://why-kafka). Kafka keeps, so it can replay and let a new downstream catch up on history, at the cost of managing retention, offsets and ordering yourself. SNS+SQS deletes, so none of that needs managing. AWS runs all of it, with DLQ and automatic retry out of the box, and the cost is no replay.

---

## When to use this pair

If the need is "something happened, tell a few services to each do their part, and that is the end of it", with decoupling, peak shaving and failure isolation but no re-reading and no new downstream catching up on history, then SNS+SQS is the cheapest choice: fully managed, no broker to run yourself.

The other way round, as soon as replay is needed, or the same data has to be read from the start by several downstreams, that is the problem [Kafka's "keep"](article://why-kafka) solves, and SNS+SQS cannot fill that gap.
