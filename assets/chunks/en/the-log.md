---
title: "The Log"
slug: the-log
brief: "Append only, ordered, immutable."
date: 2026-03-09
updated: 2026-10-18
revisions: 2
---

# The Log

Think of Kafka as a log, not a queue.

First, what a log looks like. It is just a file on disk. New data can only be added at the end, and every record added gets a position number, counted from 0. What is written is never changed, never inserted in the middle, and never disappears because someone read it. Five messages come in and the file is [0] [1] [2] [3] [4]; whoever reads it sees the same five records in the same order.

That is the case for one partition. A Kafka topic is usually split into several partitions, each partition is a log of its own, and each numbers its records from 0. A topic with three partitions that receives five messages might put two in P0, two in P1 and one in P2, and then the order a consumer reads them in is not necessarily the order they were written, because order holds only inside one partition. To read all messages for one order in sequence, give them the same key: messages with the same key are written to the same partition.

## The biggest difference from RabbitMQ

RabbitMQ is a queue: a consumer takes a message, acks it, and the server deletes that message. It is the server that remembers who took what.

Kafka deletes nothing. The message stays in the log (for how long is a retention setting), and the server does not record who took each message. It stores just one number per consumer group per partition, the offset: "which record has been read up to". The consumer moves that number forward. After processing a batch, the consumer commits the new offset to the broker, which writes it to an internal topic, `__consumer_offsets`, and replies with success only after every replica has received it.

## Offset

```
Log:  [0] [1] [2] [3] [4]
               ↑
Consumer A offset: 2
```

Consumer A has processed 0 and 1 and commits offset 2 to the broker. Then it dies. On restart it asks the broker for that 2 and continues from [2], missing nothing. If A had processed [2] and died before committing, the broker would still hold 2, and after the restart A would start from [2] again, so [2] gets processed twice. To recompute last month's data, set the offset back to 0 and read from the start; the log is still there anyway.

Two services read the same log, each with its own offset. A is at 2; a newly launched B starts from 0 and catches up on the past. Neither affects the other, and the server keeps no copy for either of them.

## Why call it a log?

It is the same concept as a database's WAL (Write-Ahead Log) and Raft's consensus log: append-only, ordered, immutable. The difference is that the WAL and the Raft log stay hidden inside their systems, while Kafka opens the log for consumers to read directly.
