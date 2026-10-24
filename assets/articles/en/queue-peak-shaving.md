---
title: "Where a message gets lost, and how to get it back afterwards"
slug: queue-peak-shaving
subtitle: "A queue shaves the peak and flattens the spike, but the queue itself loses messages: producer, broker and consumer can each lose one, and each has a fix."
chapter: "buffer"
tags: [kafka, message-queue, idempotency, exactly-once, system-design-interview]
date: 2026-03-31
updated: 2026-10-17
revisions: 1
related: [cache-hot-key, rate-limiter, scaling-first-move]
---

# Where a message gets lost, and how to get it back afterwards

A queue sits in front of the DB to absorb write traffic. But if the producer, the broker or the consumer fails, a message can be lost.

[Cache](article://cache-hot-key) and queue both **put a buffer layer between two ends**. The difference: a cache absorbs reads and a queue absorbs writes, so the consequences of failure and the defenses differ too.

---

## Why a queue: peak shaving

A burst of requests arrives in one time window. Without a queue, every request goes straight to the DB.

```text
No queue:
  10,000 req/s → DB → DB overloaded → down

With a queue:
  10,000 req/s → Queue (holds them first) → Consumer pulls 2,000 per second → DB stays steady
```

The producer writes fast, the consumer reads slowly, and the difference piles up in the queue. After the peak, the consumer works through the backlog. User requests are not rejected, only delayed by tens of seconds.

Any component that lets write speed and read speed differ can shave peaks:

| Tool | Shaves peaks? | Traits |
|---|---|---|
| Kafka | yes | messages stored on disk, any backlog size is fine |
| RabbitMQ | yes | since 3.12 a classic queue writes messages to disk and keeps only a small part in memory ready to send, so memory stays flat during a backlog |
| Redis List | yes | LPUSH / RPOP, simple but no ack |
| SQS | yes | managed by AWS, nothing to maintain yourself |
| a database table | yes | write a row as the queue, a worker polls on a schedule; the crudest, but it works |

All of these shave peaks, but after a message is read, Kafka keeps it while RabbitMQ, SQS and Redis List delete it. That splits them into two camps:

### The Log camp vs the Queue camp

| | Log camp (Kafka) | Queue camp (RabbitMQ, SQS, Redis List) |
|---|---|---|
| After a message is read | not deleted; waits for retention to expire | deleted |
| Multiple consumers | each tracks its own offset, zero cost | copy to multiple queues (fanout) |
| replay (re-read old messages) | yes, rewind the offset | no, deleted is gone |
| Nature of a message | a fact that happened (event) | a task to complete (task) |

```text
Log camp: a message is a history record, written once and never changed; each reader tracks its own progress
  Kafka partition: [msg1][msg2][msg3][msg4][msg5]
                          ↑              ↑
                   Consumer A is here  Consumer B is here

Queue camp: a message is a task, discarded once handled
  RabbitMQ queue: [msg1][msg2][msg3]
                    ↑
              Consumer A takes it → ack → deleted → Consumer B never sees it
```

Click events, transaction records, user behavior, "facts that happened" → Kafka, because several systems (analytics, recommendation, risk control) each need to read them.

Sending email, processing an order, compressing an image, "tasks to complete" → RabbitMQ or SQS. Once done, nobody needs them.

Details on choosing one in [Choosing a Queue](chunk://message-queue-comparison).

---

## The queue itself loses messages too

The queue has caught the peak traffic. But can a message be lost inside the queue?

A message can be lost at three points.

```text
Producer ──→ Broker ──→ Consumer
   ①            ②           ③
  sent,        received,    received,
  not received not stored   not processed
```

---

## ① Producer: sent, but the Broker never received it

The network dropped. The producer thinks it sent the message. The broker never received it.

### The choice: wait for an ack or not

```text
acks=0     send and stop caring                  fastest, loses messages
acks=1     ack once the leader has it            may lose (leader dies before syncing to a replica)
acks=all   ack once every in-sync replica has it   slowest, no loss
```

An in-sync replica (ISR) is one that has kept up with the leader without falling behind.

No ack, resend. Most scenarios use `acks=all`.

### The cost

`acks=all` waits for every in-sync replica to confirm, so latency goes up. But latency on the producer side is usually not the bottleneck. Write volume is.

---

## ② Broker: received, but died before storing it

The broker receives the message, it is still in memory, and the machine loses power.

### The choice: how many copies

```text
replication factor = 1   one copy; that machine dies and it is gone
replication factor = 3   three copies; one dies, two remain
```

Combined with `acks=all` and `min.insync.replicas=2`, a producer sending one message gets an ack only after at least two brokers have written it. One dies, the other still has the full data. If only one in-sync replica remains, the write is refused outright instead of silently stored once.

### The cost

More replicas means several times the storage space and extra sync latency. In return, one broker dying loses no messages.

---

## ③ Consumer: received, but died before finishing

The consumer pulls messages from Kafka, auto commits the offset (automatically reports "I have read these"), then dies before finishing. The offset Kafka recorded is already past that batch, so after a restart they are not sent again.

### The choice: when to report "I have read these"

```text
auto commit (default):
  pull → hand off to async processing → next poll commits the previous batch → die before processing finishes → message lost
  (a plain loop that processes synchronously before the next poll is really at-least-once; loss happens only when the commit runs ahead of the work)

manual commit:
  pull → finish processing → then commit → die mid-processing → restart from the last offset
```

### The cost

Manual commit is a little slower (one more confirmation) but guarantees no loss.

---

## The price of losing nothing: the same message may run twice

All three points rely on "resend if not confirmed" to guarantee no loss. But a resend can process the same message twice.

```text
Consumer finishes, writes to the DB successfully, but the offset commit fails
  → after restart, starts again from the last offset
  → the same message is processed once more
  → the DB has a duplicate row
```

So the consumer must be **idempotent** ([Idempotency](chunk://idempotency)): processing the same message twice gives the same result as processing it once.

```text
debit message {order_id: 123, amount: 100}
  → first time: check order_id=123, not processed → debit 100 → record as processed
  → received again: check order_id=123, already processed → skip
```

---

## Three delivery semantics

| Semantics | Meaning | How | Cost |
|---|---|---|---|
| At most once | at most once, may lose | send and stop caring, auto commit with async processing | fast, but loses |
| At least once | at least once, may duplicate | ack + manual commit | no loss, needs idempotency |
| Exactly once | exactly once | Kafka EOS (with conditions) | slowest, many restrictions |

**at least once** means "resend if no ack". It guarantees no loss but may deliver twice. **Idempotent** means the consumer gets the same result from handling a message twice as from handling it once, which cancels out those duplicates. The two together come close to exactly once, without actually having to deliver "exactly once".

### Is exactly once really achievable?

**EOS (Exactly-Once Semantics)** is what Kafka has offered since 0.11: a guarantee that every message is neither lost nor duplicated. But it has conditions:

```text
Kafka → Kafka: exactly once ✓
  (Kafka guarantees it internally with transactions; producer and consumer are both inside Kafka)

Kafka → external DB: back to at least once + idempotency
  (Kafka cannot control whether the DB write succeeded)
```

As soon as the write target is outside Kafka, the guarantee no longer holds. So in practice exactly once almost equals "at least once + idempotency". Kafka only saves some of the idempotency work within its own boundary.

---

## Digging further

---

> **"The consumer is too slow and the queue backlog keeps growing. What now?"**
>
> Scale consumers horizontally. Kafka's partition mechanism supports this by design: one partition can be read by only one consumer in a consumer group. More consumers, more throughput.
>
> ```text
> 3 partitions, 1 consumer  → one reader for 3 partitions
> 3 partitions, 3 consumers → one partition each, throughput x3
> 3 partitions, 5 consumers → 2 sit idle (consumers cannot outnumber partitions)
> ```
>
> Consumers not fast enough → add consumers first. Consumer count already equals partition count → add partitions (needs a rebalance).

---

> **"The producer sends too fast and the Broker cannot write fast enough. What now?"**
>
> Batch on the producer side: accumulate a batch and send it together, so there are fewer network round trips. The Kafka producer batches by default (`linger.ms` + `batch.size`).
>
> Add partitions on the broker side: each partition is an independent append-only log, so writes can run in parallel. More partitions, higher write throughput.

---

> **"The whole queue is down (the entire Kafka cluster). What now?"**
>
> The same problem as a cache avalanche: the buffer layer disappears and traffic goes straight downstream.
>
> Two strategies:
>
> - **Degrade**: when Kafka is down, write to the DB directly. Peak shaving is lost but no data is, as long as the DB can take the peak for a short while.
> - **Local buffering**: the producer writes to a local file or an in-memory queue and sends the backlog once Kafka recovers. The DB is untouched, but a producer restart loses the local buffer.
>
> If the DB can take the peak for a short while, degrade and write to the DB directly, losing nothing. If it cannot, switch to local buffering, at the cost that a producer restart loses the batch not yet resent.

---

## Compared with the previous article

| | Cache (absorbs reads) | Queue (absorbs writes) |
|---|---|---|
| Normal role | the DB does not handle repeated reads | the DB does not take peak writes |
| On failure | avalanche / penetration / stampede | message loss / duplicate consumption |
| Core defenses | random TTL, mutex, bloom filter | ack, manual commit, idempotency |
| In common | buffer layer gone → DB overloaded | buffer layer fails → data inconsistent |
