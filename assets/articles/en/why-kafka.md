---
title: "You already have Postgres and Redis. Why run a Kafka as well?"
slug: why-kafka
date: 2026-07-12
subtitle: "Kafka has one answer nobody else can give: it keeps the messages. Replay, multiple downstreams, CDC and event sourcing all come from that one point, and the price is that retention, ordering and offsets are yours to manage."
chapter: "messaging"
tags: [kafka, event-sourcing, cdc, replay, streaming, system-design]
related: [message-system-axes, kafka-partitions-groups, sns-sqs, rabbitmq-routing, the-log, url-shortener-demo, queue-peak-shaving]
---

# You already have Postgres and Redis. Why run a Kafka as well?

Postgres already stores the data and Redis already caches it. Kafka is a third system to operate, to monitor, and to break. What does it add that Postgres and Redis lack?

Kafka's position on the four questions (the four from [the previous article](article://message-system-axes)): delivery is by consumer group, push versus pull is pull, and the position is at the back end. RabbitMQ and SQS can answer those three more or less too. On the storage question, only Kafka answers **keep it**: a message is not deleted after it is read, and the consumer records for itself which entry it has reached.

Kafka's uses that sound independent of each other, replay, multiple downstreams, CDC, event sourcing, all come from "keep" in the end.

---

## Kept, so a failure can be redone

A crashed consumer is something a queue can handle too, because a message without an ack is redelivered. The split happens after the ack. The queue deletes. Kafka keeps, and all the consumer records is a bookmark called the offset, marking which entry it has read up to.

To see the difference, run the demo's click events once. The consumer reads `click-events`, decides the device, and writes into ClickHouse:

```text
log (read, not deleted):
  offset 0  {"short_key":"abc123","user_agent":"...iPhone...","device":"mobile"}
  offset 1  {"short_key":"xyz789","user_agent":"...Windows...","device":"desktop"}
  offset 2  {"short_key":"abc123","user_agent":"...Android...","device":"mobile"}
  offset 3  {"short_key":"qqq111","user_agent":"...iPhone...","device":"mobile"}

consumer bookmark = 4, all four rows written into ClickHouse
```

One day the device detection turns out to have a bug: every Android was recorded as desktop, and that batch in ClickHouse is dirty. Kafka's way out: fix the code, move the bookmark back to 0, read the four entries again, clear ClickHouse and rebuild. A queue cannot offer this path. Those four entries were deleted at the moment of the ack, and the bad data has no raw material to recompute from.

Backfilling history works the same way, by re-reading the log. A brand new service goes live today and wants the last three months of data: read from offset 0 to the end and it is there. How offsets work and how several consumers split the reading are in [The Log](article://the-log) and [consumer groups](chunk://consumer-groups).

---

## Kept, so one copy of the data serves many readers

On the same log, billing, analytics and audit each open their own consumer group, each records its own offset, and none interferes with the others. To add a fourth downstream, open a new group. The existing services stay untouched, and the producer does not have to send an extra copy.

```bash
# same topic, two groups each read on their own and record their own offset
kafka-console-consumer --topic orders --group billing   --from-beginning
kafka-console-consumer --topic orders --group analytics --from-beginning
```

Each bookmark moves at its own pace. After running for a while, it looks like this:

```text
log:         [0][1][2] ……………………………… [498][499][500] (tail)
billing      bookmark 500   bills in real time, right behind the tail
analytics    bookmark 20    nightly batch job; falling behind during the day is fine
alerts       bookmark 0     went live today, catching up from three months back
```

Three downstreams at completely different speeds read the same data without affecting one another.

This is not the fan-out SNS does. SNS copies the message N times at publish time and pushes it to N subscribers. Kafka stores one copy, and each reader comes to fetch it. The first puts the cost on the write side; the second leaves the choice to the read side. Because the messages are kept, the read side decides when to read, how many times, and how many readers.

---

## Kept, so a DB change can be announced

Suppose order status lives in Postgres, and payment, inventory and notification all have to react when it changes. The most direct approach is for the app to write the DB and then publish an event itself, the dual write, but that is two independent writes. If the DB write succeeds and the event publish fails, the DB has the change and the downstream never hears about it.

[CDC](chunk://cdc) (Change Data Capture) is the other approach: the DB already writes the [WAL](chunk://wal) on every commit. Debezium taps that WAL and turns every change into an event sent into Kafka. The app writes only to Postgres, each downstream subscribes on its own, and the DB has no idea Kafka exists.

In practice the app runs exactly one SQL statement from start to finish:

```sql
UPDATE orders SET status = 'paid' WHERE id = 42;
```

The commit enters the WAL, Debezium reads the change and turns it into an event written into Kafka's `orders` topic:

```json
{"op": "u",
 "before": {"id": 42, "status": "pending", "amount": 990},
 "after":  {"id": 42, "status": "paid",    "amount": 990}}
```

Payment, inventory and notification each open a consumer group, receive this entry, see status go from pending to paid, and each reacts in its own way.

**CDC gets a free ride on a write the DB had to make anyway.** The order row is the system's truth and has to be written. CDC only pulls that existing write into Kafka. The reverse holds too: if something has no need for a DB row at all (a single click, say), do not fabricate a DB write just to use CDC. The app publishes straight into Kafka, with no detour through the DB.

---

## Kept to the limit: log as truth, DB as downstream

CDC makes the DB the truth and Kafka the derivative. Reverse that order and you get event sourcing: write the event into Kafka first, and the DB becomes a snapshot replayed from the log (a materialized view) that can be thrown away and rebuilt.

Take an account balance. What is stored is not the result "balance 120" but every change:

```text
topic account-events (key = account id; the same account goes to the same partition, so the order holds):
  offset 0  {"account":"A","op":"deposit",  "amount":100}
  offset 1  {"account":"A","op":"withdraw", "amount":30}
  offset 2  {"account":"A","op":"deposit",  "amount":50}

The balance now? Replay and sum: 100 − 30 + 50 = 120, stored as a view
The balance last Wednesday? Replay up to that point: read to offset 1 → 70
The row with balance = 120 in the DB is only a snapshot; drop it, replay once, and it is back
```

Why would anyone move the DB, the slowest part, from the lead role to a downstream? Those three event lines are the reason: the state at any point in time can be replayed, and a new view (a different database, a different aggregation) is one replay away. The cost is one extra step to query the current state, since it has to be materialized into a view first; and the view usually updates a beat late, so an entry just written to the log may not show up in an immediate query (read-after-write is no longer guaranteed).

If joins, foreign keys and constraints need to be the truth, it is DB-first with CDC. If the event stream itself is the truth, it is log-first with event sourcing. Either way, underneath is Kafka keeping the log. The only difference is which of the DB and the log derives from the other.

---

## Kept, so these are yours to manage

The messages are kept, which is what makes the uses above possible, but the following are yours to handle:

| Cost | What you handle yourself |
|---|---|
| retention | you decide how long messages stay; the disk fills up, and once expired they are really gone |
| ordering | guaranteed only inside a single [partition](chunk://partitions); no global order across partitions |
| offset | you track the progress; get it wrong and you read twice or skip entries |
| delivery guarantee | exactly-once comes with conditions; most pick at-least-once with an idempotent consumer ([exactly-once](chunk://exactly-once)) |

RabbitMQ and SQS skip all of this (delete on ack, no retention to manage, no offset to record), and in exchange they cannot give you replay either. If you want replay, you manage the list above.

---

## When you do not need Kafka

If the need is only that A hands a task to B and B finishes it, with no re-reading, no multiple downstreams, and no role as the truth, then RabbitMQ or SQS is simpler. There is no reason to run one more system just for "keep".

The [url-shortener demo](article://url-shortener-demo) is right to put clicks on Kafka, but all it uses so far is the buffer layer: "hold them first, let ClickHouse digest them slowly in batches". It has not really used replay or multiple downstreams yet. The day you want to feed the same clicks to a realtime alerting service as well, open a new consumer group and it connects, with no change to a single line of the existing pipeline.
