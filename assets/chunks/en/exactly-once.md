---
title: "Exactly Once"
slug: exactly-once
brief: "Idempotent producer, a transaction that ties the output write to the offset commit, and read_committed downstream. Is it really achievable?"
date: 2026-06-12
updated: 2026-10-19
revisions: 5
---

# Exactly Once

> Can a messaging system guarantee that a message is processed "exactly once"? Never lost, never duplicated?

For the definitions of the three delivery guarantees (at-most / at-least / exactly-once), see [delivery guarantees](chunk://delivery-guarantees).

Start with where a duplicate comes from. The payment service reads message #42 from the queue: "charge order 1001 for 300". It calls the bank API and charges 300. Just as it is about to ack, telling the broker this message is done, the process is OOM killed. The broker never gets the ack, waits out the visibility timeout, and delivers #42 again. A new worker reads #42 and charges another 300. Order 1001 has been charged 600.

To avoid the duplicate, "charge the card" and "record that #42 is done" would have to be one atomic action. But the charge happens on the bank's machine and the record on the broker's, with a network in between. Do it the other way round, ack first and then charge, and the crash moves to after the ack: nothing is charged at all, and the message is lost.

## Exactly-once on the wire is impossible

Over a network you can never be sure the other side received it (the two generals problem), so the sender must be able to resend, and #42 arriving twice cannot be prevented at the root. So exactly-once in practice is **at-least-once delivery plus dedup, so that a duplicate arriving has no side effect**. The result is indistinguishable from "exactly once", which is why the more precise term is exactly-once **processing / effect**.

In the example above, the first reaction is usually to have the consumer keep its own record: before charging, check the `payments` table for order_id = 1001, skip if it is there, and write 1001 in after charging. But that only moves the record from the broker to the `payments` table, and the bank is still another machine. The bank charges 300, the worker is killed before writing to `payments`, the second #42 arrives, finds no 1001, and charges again. And if the first worker is still alive when the visibility timeout expires, two workers check at the same time, both find nothing, and the order is charged twice as well.

So the dedup has to happen on the side that charges, as an [idempotent](chunk://idempotency) charge request: the worker calls the bank API with `idempotency_key = 1001`, and the bank writes "this key has been charged" and the charge itself in one transaction of its own. The second time #42 arrives, the new worker sends the same key, the bank recognizes it, does not charge again, and returns the result of the first call. This assumes the bank API accepts an idempotency key. If it does not, no amount of checking on the consumer side can stop the one case where the bank charged and the worker crashed before writing to `payments`.

## Kafka's EOS

Kafka packages this into the framework:

- **Idempotent producer**: every message carries a producer id + sequence number. The broker drops a repeated sequence number, so a producer resend does not become two copies.
- **Transactions**: the consumer reads #42, computes a result to write into another topic, and "writing the result message" and "committing the offset of #42" are bound into one transaction. All succeed or none count. A crash in the middle aborts the transaction, the offset does not move, and the retry writes a new copy of the result. The aborted copy stays in the topic, and a downstream consumer skips it only if it sets `isolation.level=read_committed`. The default for this setting is `read_uncommitted`; with the default, downstream reads both the aborted copy and the retried one, which is two copies again.

This holds only between Kafka's own topics. When the result has to go into an external system (the bank API or a DB in the example above), Kafka's transaction does not reach there, and the dedup for that part is still yours to handle. For a DB, write the result and the offset in one DB transaction and read the offset back from the DB on restart, which is exactly once as well; the bank API cannot share a transaction with the offset, so it relies on the idempotency key above.

Using only at-least-once plus an idempotent consumer gives the same final state, without turning on Kafka's full transaction mechanism.
