---
title: "Outbox Pattern"
slug: outbox-pattern
brief: "The event and the business write go into an outbox table inside the same transaction; CDC pushes it out, so the two writes cannot disagree."
date: 2026-07-20
updated: 2026-07-20
revisions: 2
---

# Outbox Pattern

Writing to the DB and publishing an event are two systems. Doing them separately is a dual write: the DB succeeds, Kafka fails, and the event is lost. The outbox pattern treats "the event to publish" as one more row, written in the same transaction as the business data:

```text
BEGIN;
  INSERT INTO orders (...);
  INSERT INTO outbox (event_type, payload);
COMMIT;
       ↓
   CDC pushes the outbox to Kafka
```

The transaction guarantees both rows succeed or fail together. Then [CDC](chunk://cdc) watches the outbox table and pushes the event to Kafka.

The gain: app code controls which events go out ([domain event](chunk://domain-event)) and does not expose the DB schema to downstream. The cost: one more table, and rows already sent need periodic cleanup.

- **Is the outbox some special mechanism?** No. It is an ordinary table you `CREATE TABLE` yourself, with columns roughly `id, event_type, payload, created_at`. What is special is the usage: the app only INSERTs into it, and CDC is the only reader.
- **How does it relate to the [WAL](chunk://wal)?** The WAL is the DB engine's own log; every write (including the INSERT into the outbox) goes into the WAL first. CDC reads the WAL, so the outbox rows flow out on their own. The two sit at different layers: the outbox is a table designed at the app layer, the WAL is the channel it leaves the DB through.

## Why not just CDC the business tables?

When downstream only needs a copy of the data (search index, cache invalidation, loading a data warehouse), CDC on the business tables is enough, and an outbox is extra work for nothing. Integration events across services are what need the outbox.

1. **The intent is gone.** "Place an order" is one transaction touching five tables. What flows out of the WAL is five unrelated row changes, and downstream has to piece "someone placed an order" back together. In the outbox it is one `OrderPlaced` row; the event itself is the intent.
2. **Internal schema becomes a public API.** If downstream subscribes to the `orders` table directly, one renamed column or one table split breaks every consumer at once. The outbox payload is a designed event format; internal refactoring does not touch it.
3. **Filtering and privacy.** Whole rows of business tables flow out, including cost price, personal data, and other columns downstream should not see. The outbox holds only the columns meant for downstream.

Both paths leave the DB through the WAL. With CDC on business tables, downstream sees individual row changes; through the outbox, downstream sees designed events.
