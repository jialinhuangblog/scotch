---
title: "The Log: it is just echo >> log.txt, and Raft / Kafka / WAL / CDC are all built on it"
slug: the-log
date: 2026-03-11
updated: 2026-10-17
revisions: 1
subtitle: "Kafka, Raft and databases are all built on a log, because once something is written into the log its order never changes."
chapter: "extras"
tags: [kafka, log, streaming, raft, consensus, wal]
related: [etcd-raft, storage-deep, compaction-merge]
---

# The Log: it is just echo >> log.txt, and Raft / Kafka / WAL / CDC are all built on it

[Raft](chunk://raft) uses it to bring three nodes to consensus, Kafka uses it to replay messages, and databases use it to recover after a crash. Systems this different share one mechanism underneath.

---

## A log only grows at the tail

A log is written one record at a time, in time order, and new records go only at the tail. What is written cannot be changed or deleted. It is the same as `echo "one line" >> log.txt`: it just keeps adding to the end of the file.

```
Index 1: event A
Index 2: event B
Index 3: event C
```

Anyone who takes the same log and replays it from the start gets the same result.

In a distributed system, several machines have to agree on the order of events. If each one replays the same log by index, they all end up with the same order.

---

## Logs everywhere you look

**Durability**: after a database crashes, how does it get back to the state it was in before the crash?

The fix: before writing anything, write "what I am about to do" into a log ([WAL](chunk://wal)). After a crash, replay the log and the state comes back. PostgreSQL, MySQL (the InnoDB redo log) and SQLite in WAL mode all do this.

**Consensus**: how do three nodes agree on the order of one sequence of operations?

The fix: use a log so every node agrees on the order of operations. Raft, [Paxos](chunk://paxos) and ZooKeeper's ZAB protocol all have a log underneath.

**Streaming**: how do services pass events to each other without losing any, and with replay?

The fix: make the log the product itself. Producers write into it, consumers track their own position, and anyone who wants a replay gets one. Kafka, Pulsar, Kinesis.

**Change propagation**: the database changed. How do the other systems find out?

The fix: read the database's internal log (WAL, binlog) and send the changes out. Debezium is one such tool. This is called CDC (Change Data Capture).

**Observability**: something went wrong in the system. How do you find out what happened?

The fix: every service writes its own behavior as a log, and the logs are collected in one place for people to search. Logstash collects, Elasticsearch indexes, Kibana visualizes. This is the application log. Its consumer is an engineer, not a system.

**Audit**: who did what, and when?

The fix: record every operation, make it impossible to alter, and hand it to compliance and security for review. AWS CloudTrail, GCP Audit Logs.

---

## Why it always ends up as a log

The six kinds of log have different consumers and different purposes, but each one chose a log **because the order can be trusted**.

Records only go at the end and nothing in the middle can change, so a replay gives the same result, and when the record is audited, nobody could have changed it after the fact.

---

## Jay Kreps said it in 2013

He wrote an article at LinkedIn titled "The Log", with the subtitle:

> What every software engineer should know about real-time data's unifying abstraction.

The subject was not Kafka (although he is one of Kafka's authors) but the log as a general pattern: databases, consensus and streaming all deal with the order of events, so all of them can use it.
