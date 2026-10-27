---
title: "Why does a DB have a connection limit?"
slug: db-connections
subtitle: "Each PostgreSQL connection is a process, and too many slow the whole machine down. Put PgBouncer in between: most web apps use transaction mode, and services that need SET, PREPARE or LISTEN/NOTIFY switch to session mode."
chapter: "buffer"
tags: [postgresql, pgbouncer, connection-pooling, db-access-control, system-design-interview]
date: 2026-03-31
updated: 2026-10-17
revisions: 1
related: [pg-tradeoff, db-access-control, resource-pool-pattern, browser-connection-reuse]
---

# Why does a DB have a connection limit?

In development, connecting to the DB is simple: fill in the connection string and the framework connects. In production, the connection itself becomes a performance bottleneck.

---

## Why connections are expensive

Send the same 100 connections to PostgreSQL and to MySQL, and they react completely differently.

For every incoming connection, PostgreSQL forks a new OS process. Each process has its own separate memory space. Measured, that is about 1 to 8 MB per connection, depending on whether huge_pages is on.

```text
100 connections into PostgreSQL:
  → fork 100 processes
  → each process has its own address space, about 1-8 MB
  → the connections alone use hundreds of MB of RAM
  → the OS has to context switch between 100 processes
```

Why is there a context switch? A machine has a limited number of CPU cores (usually 4-16), but 100 processes want to run queries at the same time. The OS has to keep switching: pause process A, save its registers and memory mapping, load process B's state, let B run for a short slice, then move on to the next. That is a context switch. The more processes, the more CPU time goes to "switching" and the less to "running queries". Even if all 100 processes run exactly the same code, each one still has its own address space. On every switch the OS has to swap the page table, and the TLB (the CPU's cache for address translation) has to be flushed as well. That is far more expensive than switching between threads.

For every incoming connection, MySQL opens a thread. Threads share the address space of one process, so the memory overhead is much smaller and switching is faster.

```text
100 connections into MySQL:
  → open 100 threads, all inside one process
  → shared address space; each thread only needs its own stack (usually a few hundred KB)
  → context switches stay inside one process, faster than switching between processes
```

So MySQL with a few thousand connections is not a big problem, while PostgreSQL slows down at a few hundred.

### Why not just raise max_connections

PostgreSQL defaults to `max_connections = 100`. The instinct is to raise it, but the returns diminish.

At 100 processes, the time a query spends queuing for locks and competing for CPU is still acceptable. At 500 processes, the latency of the same query can go from 2ms to 8ms, because the OS spends more time switching between processes than running queries. Five times the connections, and throughput goes down instead of up.

---

## Connection counts in production

```text
5 app servers × 20 connections each = 100 connections
  → exactly the max_connections limit

add one server:
6 × 20 = 120 connections
  → over the limit, new connections are refused
  → the on-call gets an alert in the middle of the night
```

Serverless is worse:

```text
AWS Lambda, one connection per invocation
  → 1,000 concurrent invocations in an instant
  → 1,000 connections hit PostgreSQL
  → every connection beyond max_connections is refused
```

---

## PgBouncer: the connection pool

Put a proxy between the app and PostgreSQL that maintains a pool of connections.

```text
App Server A ─┐
App Server B ─┤→ PgBouncer (maintains 20 real connections) → PostgreSQL
App Server C ─┘

100 "virtual connections" share 20 "real connections"
```

The app connects to PgBouncer at almost zero cost (PgBouncer is written in C and lightweight). PgBouncer takes a real DB connection from the pool and hands it to the app. When the app is done, the connection goes back, and the next app uses it.

---

## The ORM does not know PgBouncer is in the middle

Once PgBouncer takes over, the ORM's connection string changes from `host=db.internal port=5432` to `host=pgbouncer.internal port=6432` (PgBouncer's default port). One config line changes. Nothing else changes.

The pool size in the ORM or driver connection string (for example `?pool_size=20`) controls the number of "virtual connections" from the ORM to PgBouncer, not the number of "real connections" from PgBouncer to PostgreSQL. PgBouncer has its own `default_pool_size` setting that decides how many real DB connections it maintains. The ORM may open 20 connections while PgBouncer serves them in turn with only 5 real connections behind it.

The ORM cannot tell whether it connected to PgBouncer or to PostgreSQL. If the connection string connects, it treats that connection as a direct DB session.

```text
In development (direct to PostgreSQL):
  ORM → PostgreSQL
  one connection = one session; anything SET stays set

In production (PgBouncer in between):
  ORM → PgBouncer → PostgreSQL
  the ORM thinks it is still connected directly, but the real connection behind it may change on every transaction
```

Many ORMs run `SET search_path`, `SET statement_timeout`, `SET timezone` in an init hook when they get a connection. They run it once and assume the setting stays. With a direct connection that is completely fine.

But PgBouncer swapped the real connection behind the scenes. The ORM does not know, and does not SET again. So `search_path` falls back to the default and the query reads the wrong schema. Nothing in this process raises an error. Only the result is wrong.

---

## The three pooling modes

PgBouncer always swaps connections. The pooling mode decides when.

### Transaction Mode (the most common)

When a transaction ends, the real connection goes back to the pool.

```text
ORM connects to PgBouncer (virtual connection, stays alive)
  → init hook: SET search_path = 'tenant_a' → set on real connection #7
  → BEGIN → INSERT → COMMIT → real connection #7 goes back to the pool
  → next query → PgBouncer hands out real connection #3
  → search_path is the default; the ORM does not know and does not SET again
```

One HTTP request is usually one transaction, and the connection is released as soon as it finishes. Pool utilization is high. But all session state across transactions is lost: variables from `SET`, statements from `PREPARE`, subscriptions from `LISTEN/NOTIFY` (the connection stays open, waiting for the server to push notifications).

Newer PgBouncer versions have a `max_prepared_statements` setting that tracks, in transaction mode, the named prepared statements the driver sends at the protocol level. A `PREPARE` written in SQL is still lost.

### Session Mode

The connection goes back only when the whole session ends. Until the ORM disconnects, the real connection is not swapped.

```text
ORM connects → gets real connection #7
  → SET timezone = 'Asia/Taipei'    ← stays in effect
  → Transaction 1: BEGIN → INSERT → COMMIT
  → Transaction 2: BEGIN → SELECT → COMMIT
  → PREPARE stmt AS SELECT ...      ← stays in effect
  → disconnect → real connection #7 goes back to the pool
```

When is `SET timezone` needed? PostgreSQL stores timestamps internally as UTC. `SET timezone = 'Asia/Taipei'` makes the server convert UTC to Taipei time when it returns results. In a multi-tenant SaaS, each tenant may be in a different time zone, and converting on the server is more uniform than converting on the client. If the data is stored only as `timestamptz` and every time zone conversion happens in the application layer, there is no need for SET timezone, and transaction mode never runs into this problem.

The most complete feature set, and it behaves like a direct connection. The cost: connections are held the longest, and pool utilization is the lowest.

### Statement Mode

The connection goes back after each SQL statement.

```text
SELECT * FROM users → take #7 → run → return #7
INSERT INTO orders → take #3 → run → return #3
```

PgBouncer refuses a multi-statement transaction outright in this mode (the docs say "Multi-statement transactions are disallowed"), so `BEGIN` / `COMMIT` cannot be used at all. Almost no production scenario picks this.

### Default to transaction mode, switch to session mode only when session state is needed

| Mode | When the connection is swapped | Transactions | SET / PREPARE | Pool utilization |
|---|---|---|---|---|
| Session | session ends | yes | yes | low |
| Transaction | transaction ends | yes | not across transactions | high |
| Statement | every SQL statement | no | no | highest |

Most web applications pick Transaction mode. One request is usually one transaction, so a connection swap rarely affects it, and pool utilization is higher than in session mode. If the application code uses no `SET`, `PREPARE` or `LISTEN/NOTIFY`, transaction mode is the safe default.

Scenarios that need `PREPARE`, `SET` or `LISTEN/NOTIFY` use Session mode. Before switching modes, take inventory: does the application code or the ORM depend on session-level state. If it does, transaction mode is out, or every transaction has to start by redoing the SET.

---

## Session / Transaction / Statement: sorting out the terms

These three words mean different things in different contexts.

### Session and Transaction in the database

```text
Session: the whole period from connecting to the DB until disconnecting
  └── Transaction: the operations from BEGIN to COMMIT/ROLLBACK
       └── Statement: one SQL statement (SELECT / INSERT / ...)
```

One session can hold many transactions. One transaction can hold many statements.

```text
Session begins (connect to the DB)
  ├── SET timezone = 'Asia/Taipei'     ← a session-level setting
  ├── Transaction 1
  │    ├── BEGIN
  │    ├── INSERT INTO orders ...      ← statement
  │    ├── UPDATE inventory ...        ← statement
  │    └── COMMIT
  ├── Transaction 2
  │    ├── BEGIN
  │    ├── SELECT * FROM orders        ← statement
  │    └── COMMIT
  └── Session ends (disconnect)
```

### PgBouncer's pooling modes

PgBouncer's three modes pick one of these three levels as the cut point:

```text
Session mode:      cut when the session ends → the whole session shares one DB connection
Transaction mode:  cut when the transaction ends → each transaction may use a different DB connection
Statement mode:    cut when the statement ends → each SQL statement may use a different DB connection
```

The finer the cut, the sooner connections are released and the higher the pool utilization, but the fewer features work.

### The decision path in real life

During development the app connects straight to PostgreSQL. No PgBouncer, no mode to think about. After launch, traffic grows, the connection count approaches `max_connections`, and connections start being refused. Only then does PgBouncer get added, in the default transaction mode, because the docs say so and most tutorials recommend it.

After that everything works, until one day the multi-tenant `search_path` occasionally reads the wrong schema, or `LISTEN/NOTIFY` notifications stop arriving for no visible reason. The application code did not change. PgBouncer swapped the connection behind the scenes, and the session settings the application assumed were still there are gone.

Think of a real connection as an office desk, and `SET search_path`, `SET timezone` as the chair height you adjusted. Transaction mode is taking turns: each transaction sits at whichever desk happens to be free, and gives it back when done. The previous transaction adjusted the chair at desk #7. This transaction sits at desk #3, where the chair is at the default height. The original setting is still at desk #7, which is to say still on real connection #7.

There are two ways forward:

```text
Route A: stay in transaction mode, redo the SET
  → SET search_path / timezone again at the start of every transaction
  → the ORM usually has a before_transaction hook for this
  → cost: one extra round trip per transaction

Route B: fall back to session mode
  → behaves like a direct connection; SET is never lost
  → cost: pool utilization drops, may need more real connections
```

Back to the desks: Route A adjusts the chair every time you sit down (redo the SET at the start of every transaction), whichever desk it is, before using it. Route B asks for a desk of your own for the whole day (session mode). Adjust the chair once and it stays, at the cost of that desk being occupied all day, so fewer desks are left for everyone else.

Most web APIs take Route A, because one request is one transaction and the cost of one extra SET is acceptable. Services that need `LISTEN/NOTIFY` (a long-lived connection waiting for notifications) or heavy `PREPARE` take Route B, because those features cannot be solved by "set it again every time".

Statement mode almost never appears on this path, because it cannot use transactions and fits very few scenarios.

---

## How the cloud does it

| Product | Pooling solution | Pooling mode |
|---|---|---|
| Supabase | Supavisor (shared) or PgBouncer (dedicated) | port 6543 is Transaction mode |
| AWS RDS | RDS Proxy | similar to Transaction mode |
| GCP Cloud SQL | Cloud SQL Proxy | mainly authentication, no pooling |
| Neon | built-in connection pooler | Transaction mode |

Supabase has two connection entry points:

```text
port 5432 → direct to PostgreSQL, or Session mode through Supavisor (PREPARE works)
port 6543 → Transaction mode through the pooler (connection pool)
```

Ordinary APIs use 6543 (pooling). Migrations or anything that needs PREPARE use 5432.
