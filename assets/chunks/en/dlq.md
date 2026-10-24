---
title: "Dead-Letter Queue"
slug: dlq
brief: "A message that fails every retry is moved into a separate dedicated queue, so it stops blocking the ones behind it."
date: 2026-07-12
updated: 2026-10-17
revisions: 1
article: sns-sqs
---

# Dead-Letter Queue

> One message fails every time it is processed, gets picked up again, fails again, and keeps holding its spot. How do you stop it from blocking the whole queue?

## A bad message retries over and over

Under the [visibility timeout](chunk://sqs-visibility) mechanism, a message that failed and was not deleted reappears after the timeout and gets picked up again. For normal messages that is fine; one or two retries and it succeeds. But if the message itself is bad (wrong format, the data it refers to was deleted, the code throws an exception whenever it hits it), it fails every time and reappears every time, eating the worker's processing time.

## The DLQ moves it out

A dead-letter queue is a separate queue that exists to receive these messages. Set a retry limit (maxReceiveCount, say 5). SQS counts how many times each message has been received; when the same message has been received more than 5 times without success, it is moved from the main queue into the DLQ automatically.

```text
main queue: #42 received 5 times, failed every time, received a 6th time
   └─►  over maxReceiveCount (5), #42 moves into the DLQ, the main queue flows again
DLQ: #42 waits for someone to look at it
```

Once that message is gone, the normal messages in the main queue keep being processed. The bad message is not thrown away; it stays in the DLQ, where an alert can be attached and a person can pull it out later to find the cause.

## The DLQ is also a kind of decoupling

A processing failure used to reach back and affect the main queue and every message behind it. The DLQ isolates the failed one to the side, so one bad message's problem does not spread down the whole line. That is why it is often set up together with [SNS+SQS](article://sns-sqs), filling in the failure isolation piece. SQS and [RabbitMQ](chunk://message-queue-comparison) both have DLQs built in.
