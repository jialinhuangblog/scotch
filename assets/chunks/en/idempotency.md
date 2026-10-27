---
title: "Idempotency"
slug: idempotency
brief: "Send the same request twice and the result is the same. Without an idempotency key, a retry becomes a duplicate execution."
date: 2026-03-21
updated: 2026-07-20
revisions: 2
---

# Idempotency

> Running an operation once or many times gives the same result. For an API or a distributed system to retry safely, it has to be idempotent first.

## Why idempotency is needed

The client sends a charge request. The server processes it, but the response is lost on the network.

```text
Client → POST /payments {amount: 100} → Server (charged 100)
Client ← timeout (response never arrived)
```

The client does not know whether the server processed it. The simplest move is to resend. But if the server charges another 100, the user has been charged 200.

Retries are common in distributed systems. Without idempotency, a retry can mean a duplicate charge or a duplicate order.

## Idempotency of HTTP methods

The HTTP spec defines which methods are idempotent:

```text
GET    /users/1              → idempotent (reading any number of times gives the same result)
PUT    /users/1 {name: "A"}  → idempotent (overwrites with the same value)
DELETE /users/1              → idempotent (delete once or ten times, the result is that it does not exist)
POST   /payments             → not idempotent (each call may create a new record)
```

GET, PUT, DELETE are idempotent by nature. The problem is POST.

## Idempotency Key

The most common way to make a non-idempotent operation idempotent is an idempotency key.

The client puts a unique key (usually a UUID) in the request header. The first time the server processes it, it stores the key together with the result. When the same key arrives again, the server returns the stored result and does not execute again.

```text
first time:
POST /payments
Idempotency-Key: abc-123
{amount: 100}
→ Server charges 100, stores {abc-123: {status: success, id: pay_001}}
→ returns 201 Created

second time (retry):
POST /payments
Idempotency-Key: abc-123
{amount: 100}
→ Server finds abc-123 already processed
→ returns 201 Created {id: pay_001} directly, no second charge
```

Stripe's API is designed this way. Every POST request can carry an `Idempotency-Key` header.

## How the server implements it

```text
receive request + idempotency key
  ↓
check whether the key exists
  ├─ exists → return the previous response (skip the business logic)
  └─ not found → run the business logic → store key + response → return
```

**Where to store it?** Redis with a TTL (say 24 hours). The key does not need to be kept forever, only long enough to cover the retry window.

**Race condition?** Two requests with the same key arrive at the same time. Use Redis `SET NX` (write only if the key does not exist) or a DB unique constraint as the lock. The first to grab it executes; the later one waits for the result or returns 409 Conflict.

**What to store?** Not just a "processed" flag, but the full response (status code + body). That way a retry gets exactly the same result as the first call.

## The Kafka case: same principle

In the API case, the client supplies the idempotency key. The Kafka case is different: the consumer picks a field from the message itself (say order_id) as the dedup key and skips anything already processed. Kafka's exactly-once semantics rest on the same principle: the producer attaches a sequence number, and the broker discards a duplicate sequence. Either way, the receiving end remembers "I have already handled this one".

## Common traps

**Who generates the key?** Always the client. If the server generates it, the client cannot get the same key when it retries.

**What is the key's scope?** Usually bound to user + operation type. Two different payments from the same user get different keys. Retries of the same payment get the same key.

**Expiry?** Too short, and the key has expired by the time of the retry, so the operation runs again. Too long, and storage is wasted. Stripe uses 24 hours.
