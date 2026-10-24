---
title: "Both are pools. Why does one wipe the connection after each request, and the other keep it as is?"
slug: resource-pool-pattern
subtitle: "A DB connection pool, a JVM object pool and browser HTTP keep-alive are the same pattern. A DB connection is wiped of session state on return, because the next borrower may be a different tenant. The browser keeps the TLS keys, because the next user is the same person."
chapter: "buffer"
tags: [connection-pooling, object-pool, http2, http3, quic, performance]
date: 2026-05-04
updated: 2026-10-17
revisions: 2
related: [db-connections, latency-hierarchy, cache-hot-key, browser-connection-reuse]
---

# Both are pools. Why does one wipe the connection after each request, and the other keep it as is?

Opening a PostgreSQL connection takes **50 milliseconds**. A brand new HTTP request takes **170 milliseconds**. Creating one Java object with `new` takes only 70 nanoseconds, cheap enough to ignore.

But at one million `new` per second, allocation alone adds up to 70 milliseconds. Add a GC stop-the-world pause of 5 to 50 milliseconds and the whole request budget is gone.

All three costs land in the millisecond range. The fix is the same too: **build ahead of time, borrow and return repeatedly**.

A DB connection pool wipes the session state when a connection is returned. The browser instead keeps the keys, tickets and protocol preferences it shares with the server, and the next connection to the same server starts sending at 0-RTT right away.

Both are pools. Why does the DB pool wipe everything on return while the browser keeps it all?

---

## The shared cost structure

All three resources have the same cost structure:

```
setup cost (high, one time)
   preparation: handshake, authentication, resource allocation
       ↓
   ready to use
       ↓
in use (cheap)
       ↓
teardown cost (medium, discard)
```

If the resource is destroyed after every use, the next user pays the full setup cost again from the start.

The setup cost of each resource:

### DB connection

```text
DNS lookup           ~5 ms
TCP 3-way handshake  ~7 ms
TLS 1.3 handshake    ~10 ms
PG authentication    ~10 ms
Backend fork         ~20 ms     ← PG forks one OS process for this connection
────────────────────────
Total setup cost     ~52 ms
```

PG is especially expensive at the last step: one process per connection. 100 connections means 100 processes, and scheduling and context switches both cost. Measured memory per connection is about 1 to 8 MB (depending on the huge_pages setting; ps/top often count shared memory and overestimate). The PG process model in detail is in [Why you cannot open as many DB connections as you want](article://db-connections).

### JVM object

```text
new Order():
   allocate heap memory   ~20 ns
   call constructor       ~50 ns
   ──────────────────────
   cost per object        ~70 ns

1 million new per second (high frequency trading):
   GC pressure builds up
   Young generation fills
   minor GC triggers (stop-the-world)
   pause 5 ~ 50 ms
   → 5,000 to 50,000 orders could be missed
```

A single object is cheap. **New objects piling up into GC pressure** is the real cost.

GC pressure from many short lived objects can be handled with an object pool. Large data held for a long time (order books, tick history, quote snapshots) needs a different approach; see the off-heap section later.

### HTTP request

```text
First connection:
DNS                  ~20 ms
TCP 3-way handshake  ~50 ms
TLS 1.3 handshake    ~50 ms
HTTP request arrives ~50 ms
─────────────────────────
First total latency  ~170 ms

Second (connection already open):
HTTP request only    ~50 ms
─────────────────────────
saves 70%
```

For the web, RTT is the main cost. Connection reuse removes the DNS, TCP and TLS handshakes outright.

---

## Three implementations, one skeleton

Whichever kind it is, the pool has the same structure:

```text
pool = [resource_0, resource_1, ..., resource_N-1]
              ↑
              built ahead of time, waiting while idle

borrow():
   find an idle resource
   mark it "in use"
   hand it to the client

return(resource):
   do the necessary reset
   mark it "idle"
   put it back in the pool

health check:
   verify on a schedule that the resource is still valid
   if not, discard it and build a new one
```

Fill in the actual entities:

| | DB connection pool | JVM object pool | Browser connection pool |
|---|---|---|---|
| Resource | TCP + TLS + auth + backend process | Order / Quote / Buffer objects | TCP + TLS connection |
| Borrowed when | the app queries the DB | a new message is processed | an HTTP request is sent |
| Returned when | the transaction completes | the message is processed | the response ends |
| Pool size | 20 to 100 connections | from 1024 slots up | 6 per origin (H1) or 1 (H2/H3) |
| Middle layer | PgBouncer / HikariCP | LMAX Disruptor | built into the browser |
| Setup time saved | 52 ms → 1 ms | 70 ns × a million → 0 | 170 ms → 50 ms |

The skeleton is the same. The only differences are "what the resource is" and "how often it is borrowed".

---

## Whether to reset on return

### DB connection pool: wipe everything on return

On return, the pool has to clear whatever state the last borrower left behind. The two kinds of pool do it differently.

An application pool like HikariCP checks on return whether a transaction is still open (autocommit off, uncommitted changes). If so, it sends `ROLLBACK` first, then sets JDBC settings such as autocommit and isolation level back to their defaults.

PgBouncer in session mode runs `server_reset_query` on return, `DISCARD ALL` by default (transaction mode does not run it by default). It sends no `ROLLBACK`: its docs say that at release time "no transaction is in progress" [SRC: github.com/pgbouncer/pgbouncer/blob/master/doc/config.md#server_reset_query]. PgBouncer has no way to reset a connection whose transaction is still open. Its source closes that server connection instead and logs "client disconnect while server was not ready" [SRC: github.com/pgbouncer/pgbouncer/blob/master/src/objects.c, disconnect_client()].

```text
Connection state before return:
   SET search_path = 'tenant_a'
   PREPARE stmt_x AS SELECT ...
   temp table tmp_orders still there
   advisory lock still held

PgBouncer (session mode) on return:
   transaction still open → no reset, close this server connection
   transaction finished   → run DISCARD ALL:
      session variables → reset
      prepared statements all cleared
      temp table        → DROP
      lock              → release

Kept only on the DISCARD ALL path:
   TCP socket
   TLS encryption context
   authenticated identity
   PG backend process
```

The physical connection (the expensive part to build) stays. The session state (the part that would contaminate the next user) is all cleared.

The reason: **the next borrower is a different person**.

In one pool serving a web service, the first request belongs to user_a (`SET search_path = tenant_a`) and the second to user_b. If the second request gets the first one's leftover state, that is data leaking across tenants.

### JVM object pool: reset the contents, keep the structure

```text
Before return:
   pooledOrder:
     symbol    = "AAPL"
     price     = 150.0
     timestamp = 1714780000

After return (reset):
   pooledOrder:
     symbol    = ""
     price     = 0
     timestamp = 0
   
Kept:
   the object itself (GC does not collect it)
   class structure, field layout
```

The reset is lighter than the DB one. Usually it is setters set to zero, with no SQL to run.

LMAX Disruptor is a high performance ring buffer library for Java, and it saves even more: **it never resets at all**. When the producer writes into a slot it overwrites the old contents directly, skipping the clearing step.

The reason: **the same object must not carry old data into the next message**, but the thread safety boundary is clear (single writer, ring buffer consumed in order), so it does not need to be cleaned that thoroughly.

### Browser TLS session: keep as much as possible

The complete opposite direction. The session ticket, Alt-Svc and QUIC 0-RTT keys between the browser and the server are all kept. The next connection to the same server uses them directly.

```text
First connection to example.com:
   full TLS 1.3 handshake (1 RTT)
   Server returns NewSessionTicket → it holds the PSK (pre-shared key) for later reconnects
   Browser stores: the ticket for example.com
   Browser stores: the Alt-Svc header saying the server supports HTTP/3

Second connection to example.com (ticket not yet expired):
   Browser sends the ticket: "I have connected before"
   Server decrypts the ticket with its own session ticket key → gets the PSK
   no need to send and verify the certificate again
   → still 1 RTT, but the certificate transfer and computation are skipped
     (a full TLS 1.2 handshake takes 2 RTT; only resumption brings it down to 1 RTT)

0-RTT goes one step further (both TLS 1.3 and QUIC have it):
   Browser's very first packet carries the HTTP request encrypted with the PSK (early data)
   Server decrypts the ticket and can decrypt the request
   → starts processing the request before the handshake finishes
```

The reason: **the same browser is always the same person**. The more it remembers the faster it gets, and there is no contamination across users.

---

## Why the directions differ: a DB connection changes hands, a browser does not

```text
DB pool: next user = a different client / a different user
   → any session state is a potential leak
   → wipe everything

JVM object pool: next user = a different payload, same process
   → contents must be cleared, structure kept
   → reset the fields

Browser TLS: next user = the same browser connecting to the same server
   → the more it remembers the faster it gets
   → keep as much as possible
```

What decides the direction is the **user boundary**:

| Scenario | Borrower boundary | Design direction |
|---|---|---|
| DB pool | across users (shared on the server side) | wipe |
| JVM object pool | across messages (inside one process) | reset |
| Browser TLS | same user (private to the browser) | keep |

The JVM object pool sits in the middle: its boundary is narrower than the DB's (inside one process) but wider than the browser's (shared across messages), so it does the lightest reset.

---

## A pool is not endlessly reliable

Every implementation has to handle "the resource went bad".

### DB pool: stale connection

A connection can die from a server idle timeout, a network blip or a firewall closing it. The client does not know, and only finds out when it borrows the connection, sends a query, and the other side is already gone.

HikariCP is the most used DB connection pool in Java. The relevant settings:

```text
HikariCP settings:
   connectionTestQuery: 'SELECT 1'   ← ping before lending (with a JDBC4 driver this can be left unset; Connection.isValid() is used instead)
   validationTimeout:   5000 ms
   maxLifetime:         30 min        ← discard and rebuild connections that are too old
```

`maxLifetime` is the second safeguard. Even a connection that still works is replaced on a schedule, so hidden bugs in long lived connections cannot pile up.

### JVM object pool: a missed field in reset

Objects do not "go bad", but a wrong reset carries old data into the next message. The practical approach: a unit test that checks every field is at its default value after reset.

```text
ill-formed reset:
   pooledOrder.symbol = "";
   pooledOrder.price = 0;
   // missed pooledOrder.metadata.clear()
   → the next order carries the previous order's metadata
   → the order goes to the wrong exchange, and one order loses millions
```

### Browser TLS session: ticket expiry and replay

A session ticket has an expiry. The server decides the length, and TLS 1.3 caps it at 7 days. After expiry it falls back to a full handshake.

0-RTT also carries a replay attack risk. An attacker resends the earlier encrypted request, and the server cannot tell whether it is new or old. So most servers **forbid 0-RTT** on state changing requests such as POST and DELETE, and allow it only for idempotent operations such as GET.

---

## The price of a pool: not a free optimization

Every kind of pool has trade-offs.

### DB pool

```text
✗ The ORM does not know the connection changed underneath
   → SET search_path is lost after the transaction ends
   → multi-tenant schema routing goes wrong
✗ A long transaction blocks the pool
   → fewer connections actually available
✗ Pool size set wrong
   → too big, too many processes on the server side
   → too small, the app waits for a connection
```

### JVM object pool

```text
✗ Thread safety, easy to hit a race condition
   → a shared object needs a single writer or a lock
✗ A missed field in reset carries old data
   → harder to debug than a GC bug
✗ Premature optimization, readability drops
   → ordinary business code should not write an object pool for the sake of GC
```

### Browser TLS

```text
✗ 0-RTT is unsafe for POST
   → automatic downgrade or rejection
✗ Session ticket encryption key leaks
   → a TLS 1.3 connection resumed with psk_dhe_ke still has forward secrecy, but 0-RTT early data does not
   → a TLS 1.2 ticket holds the master secret directly, so the whole session can be decrypted
✗ CDN nodes do not share tickets
   → hit rate differs between edge nodes
```

---

## When not to use a pool

Not every resource should be pooled. In these situations it is usually better to rebuild every time:

```text
setup cost < 1 ms
   → rebuilding is negligible, a pool only adds complexity

resource is stateful and hard to reset
   → clearing the state costs about as much as rebuilding, nothing saved

very low concurrency (< 10 uses per second)
   → idle time far exceeds setup time, the pool is waste

resource has a short lifetime
   → use once and throw away is simpler
```

A simple CLI tool connects to the DB, disconnects when done and exits. No pool needed. The same goes for low traffic internal tools.

Introducing a pool too early adds new problems (stale connections, reset bugs, pool size tuning) while the time actually saved is close to zero.

---

## The JVM's next steps: off-heap, a different collector, a different language

An object pool is the first layer of the fix. For web services and background ETL, where latency tolerance is tens of milliseconds, adding a ring buffer is enough.

High frequency trading, where "**every order that is 1 millisecond late can lose a million**", is different. An object pool only handles short lived objects, not data that is large to begin with. An order book can hold hundreds of millions of entries. Putting all of it on the heap fills the old generation, and a full GC can pause for several hundred milliseconds, far worse than a minor GC.

### Off-heap: move the data out of GC's sight

```text
ByteBuffer.allocateDirect(1024 * 1024 * 1024);
   → the JVM calls malloc(1 GB) internally
   → the OS hands over a 1 GB block of native memory
   → this memory is inside the JVM process but outside the heap
   → GC cannot see it at all, so it never scans it and never pauses for it
```

Off-heap is not the stack. It is a separate block of native memory the JVM process gets from the OS. The stack is each thread's own working area for function calls (about 1 MB). Off-heap can be several GB, hold any data, and be shared across threads.

Libraries in practice:

```text
Chronicle Map     — off-heap key-value store
Chronicle Queue   — off-heap message queue + memory-mapped file persistence
Aeron             — off-heap UDP messaging (exchange grade)
Netty ByteBuf     — off-heap network buffer (under most high performance servers)
```

The price: you lose the Java object model. The off-heap block is only bytes. You decide the byte layout yourself and do your own serialization and deserialization. The API feels like writing C: no methods, no type checks, and debugging is painful.

### Pick the right collector: shorter pauses

Only after the first two layers are done and still not enough do you pick a collector:

```text
ZGC          — pause target sub-millisecond
Shenandoah   — same low pause positioning (led by Red Hat)

CMS was removed in JDK 14.
Parallel and G1 (the default) remain, but their pause times do not match the two above.
```

The collector comes last because it only **shortens the pause**; it does not reduce allocation pressure. The first two layers reduce the amount of work GC has to do.

### Switch language

If latency is still over budget after all that, replace the JVM:

```text
Rust    — no runtime GC, ownership managed at compile time
C++     — manual management, fully controllable
FPGA    — order matching in hardware, nanosecond level
```

The JVM is not incapable of low latency either. The core of the LMAX trading platform runs on the JVM and handles 6 million orders per second on a single thread [SRC: martinfowler.com/articles/lmax.html], but to get there they wrote their own lock free queue, later open sourced as the Disruptor.

### The four layers side by side

| Layer | Engineering cost | What it buys | Fits |
|---|---|---|---|
| Object pool / ring buffer | medium (one component rewritten) | less transient allocation | latency budget of a few milliseconds or less |
| Off-heap | high (API style changes a lot, debugging gets harder) | large data escapes GC's sight | order books, market snapshots, tick logs |
| Different collector | low (a JVM flag) | pauses drop from tens of milliseconds to sub-ms | the first two layers are done and still not enough |
| Different language | very high (rewrite) | no GC at all | the first three layers are done and still not enough |

Engineering cost does not rise layer by layer: switching the collector changes one JVM flag. It sits after off-heap because it only shortens the pause and does not reduce GC's workload. The first two layers usually solve most of the problem.

---

## Advanced: pool of pools

Large systems often have several layers of pools:

```text
[App Server]
  └── in-app object pool (Disruptor / Netty ByteBuf)
       └── in-app connection pool (HikariCP)
            └── middle connection pool (PgBouncer)
                 └── real PostgreSQL connection
```

Every layer is a resource pool, but the resource differs:

```text
HikariCP   borrow → "a connection to PgBouncer"
PgBouncer  borrow → "a connection to PG"
PG         handles the query → runs a backend process
```

Each layer saves its own setup cost, and end to end the cost drops from 50 ms to 1 ms.

The side effect is harder debugging. When a connection fails, you first have to find which layer's pool went wrong.

---

## One pattern, three implementations

Connections, objects and HTTP are three different resources, but the pool logic is the same:

```text
1. setup is expensive
2. build a batch ahead of time
3. borrow and return repeatedly
4. do the necessary cleanup on return
5. detect failures and rebuild
```

The only difference is how deep step 4 cleans:

```text
DB pool          next is someone else → wipe everything
JVM object pool  next is the next message in the same process → light reset
Browser TLS      next is still the same browser → keep as much as possible
```

The concrete mechanics of PG connection pooling (PgBouncer's three modes, the SET search_path problem) are in [Why you cannot open as many DB connections as you want](article://db-connections). The latency scale of each layer is in [Data in the CPU cache or on disk: the read speed differs by several orders of magnitude](article://latency-hierarchy).

---

## References

- [Measuring the Memory Overhead of a Postgres Connection](https://blog.anarazel.de/2020/10/07/measuring-the-memory-overhead-of-a-postgres-connection/) — Andres Freund's measurements: about 1.3 MiB per connection with huge_pages=on, about 7.6 MiB with it off. `ps`/`top` count shared memory into every process and misreport it as tens of MB or even GB.
- The millisecond figures in this article (DNS / TCP / TLS handshake / first HTTP connection ~170 ms / backend fork ~20 ms) are illustrative. Handshake cost is a multiple of RTT by nature and changes with network distance; fork and GC pauses change with hardware and settings. The orders of magnitude are useful; the absolute values change with the environment.
