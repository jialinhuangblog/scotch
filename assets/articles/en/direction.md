---
title: "Direction"
slug: direction
subtitle: "I → T → π. The learning path behind this gallery."
chapter: "extras"
tags: [meta, direction, learning-path]
related: [direction-frontend]
---

# Direction

The common way to learn is to aim at the interview: memorize 20 building blocks, draw boxes on a whiteboard, pass, and stop. That is still a long way from architect.

---

## 2.1 My path: frontend engineer to Architect

### I → T → π

**I** is one vertical line: go to the bottom of one field. Mine is frontend: component architecture, the rendering pipeline, browser internals, performance budgets.

**T** is the same depth plus a wide horizontal line, enough to talk with every team. I got here by touching backend CRUD, databases, Kubernetes and the OSI layers of networking. The level is "can hold a conversation", not expert.

**π** is two or more deep vertical lines plus the breadth, enough to design across fields. That is the goal. The second leg has to go as deep as the first, and system design is that second leg.

### The depth map today

| Field | Depth | Status |
|---|---|---|
| Frontend / UI architecture | deep | Established. This is the first vertical line. |
| k8s / container orchestration | medium to deep | In progress. Already tracing etcd, Raft, CRI/CNI. |
| Networking / OSI | medium | In progress. Understand L4/L7, gRPC over HTTP/2. |
| Databases / storage | shallow to medium | CRUD level. Know SQL, do not know storage engines. |
| Distributed systems | shallow | Know the terms. Have not traced the cause and effect yet. |

### The second leg

Four fields turn the T into a π:

1. **Storage engines.** How does Postgres write to disk? What is a WAL? The difference between a B-Tree and an LSM-Tree decides whether a query finishes in 2ms or 200ms.

2. **Consensus and replication.** k8s depends on etcd, etcd depends on Raft. That dependency chain is already there; just follow it down.

3. **Streaming and event-driven architecture.** Kafka is not a message queue. It is an append-only log that happens to support pub/sub. Once the log makes sense, CDC, event sourcing, and why microservices work (or do not) all become easier to understand.

4. **Networking at the system level.** TCP congestion control, connection pools, why gRPC chose HTTP/2, how Envoy intercepts traffic inside a service mesh.

---

## 2.2 Typical learning paths

Same material, four kinds of engineer starting from different places.

### Path A: backend engineer to Architect

A backend engineer already knows databases, APIs and server-side logic. What is missing is the horizontal line: breadth.

```
Start: go deep in one backend stack (for example Java + Postgres + Redis)
→ learn distributed systems theory (consensus, replication, partitioning)
→ add infrastructure (k8s, networking, observability)
→ add data pipelines (Kafka, streaming, batch processing)
→ study cross-cutting topics (security, cost, organizational trade-offs)
→ Architect
```

**Advantage:** backend engineers deal with servers, latency and failures every day. Distributed systems theory describes problems they have already seen.

**Risk:** they may underestimate frontend performance limits and the latency budget on the user's side. They may also overbuild internal systems, because they have never dealt with a homepage that takes 3 seconds to paint.

### Path B: frontend engineer to Architect (this is mine)

A frontend engineer knows rendering, state management and browser APIs. What is missing is the vertical line going down: everything below the HTTP response.

```
Start: go deep in frontend (Angular, React, browser internals, performance)
→ learn backend basics (CRUD, REST, auth, server frameworks)
→ pick one infrastructure curiosity and go deep (I picked k8s)
→ follow the dependency chain down (k8s → etcd → Raft → consensus)
→ fill the breadth gaps with the building blocks checklist
→ Architect
```

**Advantage:** frontend engineers understand the user and know how many milliseconds "fast" is on the user's side. They think about caching, CDN invalidation and perceived performance, because they have measured it in Lighthouse scores and Core Web Vitals.

**Risk:** the whole backend starts as a black box, and the mental model is "the API returns data". Storage engines, replication lag, isolation levels, transaction guarantees: all of it sits behind the HTTP response, and you never touch it unless you go after it.

### Path C: SRE/DevOps to Architect

An SRE already knows infrastructure, monitoring and incident response, and sees systems fail every week. What is missing is design intent: why the system was designed that way in the first place.

```
Start: go deep in infrastructure (Linux, networking, k8s, Terraform, observability)
→ learn why systems are designed the way they are (read RFCs, design docs)
→ add database internals (storage engines, replication, consistency models)
→ add application-layer patterns (event sourcing, CQRS, saga)
→ study the product and business constraints that shape the architecture
→ Architect
```

**Advantage:** an SRE spends 99.999% [availability](chunk://sla-slo) as a budget. Converted, that is about five minutes of downtime per year.

**Risk:** they may watch only the operations side and miss the application-layer design that causes the operational pain, so they fix the symptom and never go back to change the cause.

### Path D: new graduate to the System Design interview

A new graduate knows algorithms and data structures and may have done one internship. What is missing is everything outside a single process.

```
Start: learn 10 building blocks (load balancer, cache, CDN, queue, DB, etc.)
→ practice 10-15 classic design questions (URL shortener, Twitter, chat)
→ learn to ask clarifying questions and estimate scale
→ read one book from cover to cover (Alex Xu or DDIA)
→ do mock interviews until the 45 minute rhythm feels natural
→ pass the interview
```

**Advantage:** no preconceived way of doing things. The new interview framework does not conflict with any existing understanding, so they learn fast.

**Risk:** breadth without depth. They learn "put a cache here" but do not understand cache invalidation, eviction policies or thundering herd.

---

## 2.3 How my path differs

The typical interview path is breadth-first:

```
learn 20 building block names → combine them on a whiteboard → pass → stop
```

My path is depth-first:

```
use a real system (k8s) → ask why ("why did the Pod restart?")
→ trace the dependency chain (controller → reconciliation loop → etcd → Raft)
→ reach the root problem ("how do distributed nodes reach consensus?")
→ expand horizontally from that foundation
```

**1. The starting point is curiosity, not a syllabus.** I did not start from chapter one of a textbook. I started where the questions already were: k8s is in daily use, the questions were already there, and I just followed them.

**2. Depth-first is slow, but every topic is traced to the bottom.** Breadth-first covers 20 topics in a month; I cover 4 in the same time. But by the time I reach consensus, I have traced the path from a Pod restart all the way to etcd, Raft and the FLP impossibility result. Breadth-first learns "Raft is a consensus algorithm". I know why Raft exists, and what it cannot solve.

**3. The risk is blind spots.** Frontend is deep, k8s is traced to medium-deep, but I know nothing about CDN invalidation or rate limiter algorithms. The building blocks checklist (section 2.8) exists to find the topics that depth-first skipped.

---

## 2.4 Self-taught vs structured learning

This gallery was written by self-study, but self-study fails in a few fixed ways, and structured learning covers exactly those.

### What self-study misses

**Order.** A textbook puts isolation levels after storage engines, because WAL and MVCC have to come first. Studying alone, you may jump straight to isolation levels, get confused, and spend a week going back to fill the gap. DDIA's chapter order is not arbitrary. It is a dependency graph.

**Unknown unknowns.** If you do not know a concept exists, you never think to search for it. I only learned that vector clocks matter when I read about conflict resolution in leaderless replication. A structured course brings these up before you need them.

**The feedback loop.** You finish an article on Raft and it feels complete, until someone asks "what happens when the leader's log and a follower's log conflict?" and you find you never covered it. Nobody asks that question when you study alone. Mock interviews, reading groups and code review are where someone asks.

**Calibration.** The self-taught either overestimate ("I read the Raft paper, I understand consensus") or underestimate ("I cannot explain CAP in 30 seconds, I know nothing"). A structured course has peers to compare against, which makes it easier to know where you stand.

### What structured learning misses

**Motivation from a real problem.** The course assigns "Chapter 7: Partitioning". I met partitioning because adding consumers to a Kafka consumer group changed nothing. A concept learned after the problem sticks better, because it has already solved a real one.

**The ability to read primary sources.** A course hands you the answer. The ability to read a primary source like a Kafka KIP or a CockroachDB RFC only comes from finding the answer yourself, and courses rarely teach it.

**The habit of writing.** Studying alone, you have to explain every concept to yourself. Written down, that became this gallery.

### The best combination

Read DDIA in chapter order first. Where a question comes up, go to the RFC or trace the code yourself. Write it up, then take it to a mock interview or a reading group and let people find the mistakes.

---

## 2.5 Resource assessment

### Books

#### DDIA: Designing Data-Intensive Applications (Martin Kleppmann)

The most cited system design book. It is not an interview book. It is a book about fundamentals.

| Aspect | Assessment |
|---|---|
| **Covers** | Storage engines, replication, partitioning, transactions, consistency, batch and stream processing |
| **Strength** | Explains *why* systems are designed the way they are. It traces the trade-offs instead of only describing. The chapter order is a dependency graph: each chapter needs the one before it. |
| **Weakness** | Dense. No exercises, and not organized by interview question. |
| **Fits** | Anyone who wants to understand systems deeply. Also the foundation book for this gallery. |
| **Verdict** | Must read, in chapter order. |

#### System Design Interview (Alex Xu, Volumes 1 and 2)

The most used set for interview prep. Each chapter works one design question all the way from requirements to deep dive.

| Aspect | Assessment |
|---|---|
| **Covers** | Rate limiter, URL shortener, chat system, notification system, news feed, and more. |
| **Strength** | Teaches the interview format: requirements, estimation, high-level design, deep dive. Clear diagrams. Friendly to beginners. |
| **Weakness** | Breadth over depth. It explains *what to use*, rarely *why it works that way*. After reading it you can draw a box labeled "Message Queue", but you cannot say that under Kafka sits an append-only log. |
| **Fits** | New graduates and anyone with an interview in 4-8 weeks. |
| **Verdict** | Good for getting started. Stop at this book alone and you learn the format, not the mechanism. |

### GitHub Repositories

#### donnemartin/system-design-primer

47 topics with diagrams and Anki flashcards. The most starred system design repo on GitHub.

| Aspect | Assessment |
|---|---|
| **Strength** | A thorough reference. Good for looking up a concept you forgot. The trade-off tables (SQL vs NoSQL, cache-aside vs write-through) are a useful quick reference. |
| **Weakness** | Breadth-first by design. 1-2 pages per topic. No cause and effect between topics. Consistent hashing and load balancing sit on two separate pages, and neither mentions which one inspired the other. |
| **Fits** | A dictionary. Look up the concept, then go deep somewhere else. |

#### karanpratapsingh/system-design

A structured course in Markdown. Covers theory and components, then design questions.

| Aspect | Assessment |
|---|---|
| **Strength** | Readable, with clearly organized chapters. Use it to get familiar with the vocabulary before reading RFCs or DDIA. |
| **Weakness** | Shallow. Each topic is a summary, not an explanation. Fine for a first contact, not enough for real understanding. |
| **Fits** | Preview. Skim a chapter for the vocabulary, then read the primary source. |

### Video / platforms

#### ByteByteGo (Alex Xu)

Animated system design explanations. Blog posts and YouTube videos.

| Aspect | Assessment |
|---|---|
| **Strength** | Animation can draw the data flow one step at a time, which a static diagram cannot. Good for building an intuition of how a request moves through a system. |
| **Weakness** | Not deep enough, same as the books. The animation shows a load balancer spreading traffic, but never covers the consistent hashing algorithm, the virtual node trick, or what happens when a node fails. |
| **Fits** | Visual learners. Watch the video, then read the RFC. |

### Primary sources

These are design documents written by the people who built the systems, not textbooks. Each one records the problem to solve, the approaches considered but not taken, and the design chosen in the end.

#### Kafka KIPs (Kafka Improvement Proposals)

Every major Kafka feature starts as a KIP. [KIP-500](https://cwiki.apache.org/confluence/display/KAFKA/KIP-500) explains why Kafka removed ZooKeeper.

- [KIP index](https://cwiki.apache.org/confluence/display/KAFKA/Kafka+Improvement+Proposals)
- Source code: [apache/kafka](https://github.com/apache/kafka)

#### CockroachDB RFCs

Distributed SQL. Design decisions like isolation levels, distributed transactions and TTL each have an RFC that records the context, the trade-offs and the approaches not taken.

- [All RFCs](https://github.com/cockroachdb/cockroach/tree/master/docs/RFCS)
- [Distributed SQL RFC](https://github.com/cockroachdb/cockroach/blob/master/docs/RFCS/20160421_distributed_sql.md): how to move computation next to the data.
- [Read Committed Isolation RFC](https://github.com/cockroachdb/cockroach/blob/master/docs/RFCS/20230122_read_committed_isolation.md): why adding a weaker isolation level was the right decision.

#### The etcd Raft implementation

k8s depends on etcd, etcd depends on Raft. The design document records how the Raft paper became production code.

- [etcd-io/raft](https://github.com/etcd-io/raft): the Raft library extracted from etcd.
- [design.md](https://github.com/etcd-io/raft/blob/main/design.md): how etcd implements Raft.
- [raftexample](https://github.com/etcd-io/etcd/blob/main/contrib/raftexample/README.md): a minimal Raft-backed key-value store.

#### Kubernetes Design Proposals Archive

The historical design documents for k8s features. The code today has long moved away from what the documents describe, but why it was designed that way is still written down clearly.

- [kubernetes/design-proposals-archive](https://github.com/kubernetes/design-proposals-archive)
- [Architecture overview](https://github.com/kubernetes/design-proposals-archive/blob/main/architecture/architecture.md)
- [Design principles](https://github.com/kubernetes/design-proposals-archive/blob/main/architecture/principles.md)

**Why primary sources matter:** a textbook writes that Raft uses leader election. A KIP writes why Kafka switched to its own leader election and replaced the one from ZooKeeper. The textbook has only the conclusion. The KIP has the reasoning, and the reasoning is what you can reuse when a new problem shows up.

---

## 2.6 Two learning philosophies

The structure of this gallery comes from two people's ideas.

### Elon Musk: the semantic tree, structure can be planned

> "It is important to view knowledge as sort of a semantic tree — make sure you understand the fundamental principles, i.e. the trunk and big branches, before you get into the leaves/details or there is nothing for them to hang on to."
> — Elon Musk, Reddit AMA, 2015

Musk is talking about **structure**. Learning has an order. Trunk first, then branches, leaves last. Without a trunk, the leaves have nothing to hang on.

The trunk of system design is not "load balancer" or "cache". The trunk is: **how do you store data, replicate it, and keep it consistent when machines fail?**

Everything else is a branch or a leaf:

```
trunk: storage, replication, consistency
├── branch: consensus (Raft, Paxos)
│   └── leaf: etcd's Raft implementation details
├── branch: partitioning (hash, range)
│   └── leaf: Kafka consumer group rebalancing
├── branch: transactions (ACID, isolation levels)
│   └── leaf: CockroachDB's read committed RFC
```

Most interview resources start from the leaves: "design a URL shortener", "design a chat system". After those questions you can draw the architecture diagram, but when asked why a cache goes here or why this gets sharded, there is no answer, because the storage, replication and consistency layer was never learned.

This gallery starts from the trunk. Each article traces one dependency chain, from a real system all the way to the root problem it solves.

### Steve Jobs: Connecting the Dots, only visible looking back

> "You can't connect the dots looking forward; you can only connect them looking backwards. So you have to trust that the dots will somehow connect in your future."
> — Steve Jobs, Stanford Commencement, 2005

Jobs is talking about the **timeline**. The calligraphy class, being fired from Apple, NeXT: at the time these experiences looked unrelated. Ten years later, looking back, the dots form a line. Calligraphy became the Macintosh typefaces. Being fired became Pixar.

That line cannot be planned. It can only be seen afterwards, looking back.

### The two do not contradict

Musk says: plan the structure, learn the trunk first.
Jobs says: do not plan the path, looking back it connects on its own.

This gallery uses both:

- **Dependency chains = Musk's tree.** k8s → etcd → Raft. Ordered, structured, deliberately planned depth.
- **Building blocks grid = Jobs's dots.** DNS, Redis, rate limiter, CDN are learned one at a time now, without knowing which interview question or production incident will one day string them together.

### But not every chunk is a dot

Some chunks really are dots, like DNS, rate limiter, blob storage. Learn them in any order; nothing comes before or after. But some chunks are **leaves** growing on a branch, and you need other chunks first to understand them. Isolation levels need WAL and MVCC first; consumer groups need the log and partitions first. Those are not dots. Leave a leaf lying around as a dot and you repeat the failure from 2.4: "jump to isolation levels, get confused, waste a week".

- **Needs other chunks first**: it is a leaf. Hang it back on its branch, put it in a dependency chain, after those chunks.
- **Needs nothing first, can go anywhere**: it is a dot. Leave it floating and trust that one day it connects on its own.

### The rule: first principles over analogies

Analogy is the common way to learn: "Kafka is like a message queue." Analogy is fast but leaks. Kafka is not a message queue. It is an append-only log with consumer offsets. The analogy hides the mechanism, but when Kafka breaks, what you have to look at is exactly the offsets and the log, and the analogy has neither.

First principles means breaking the problem down to the most basic facts and reasoning back up from there. Not "Kafka is like X" but "why does an append-only log solve what a traditional queue cannot?"

---

## 2.7 The Building Blocks union: cross-checking four references

I did not want to get halfway through writing and find that another repo lists a building block I had left out, so I took a complete union of the four sources first.

The four sources:

1. **donnemartin/system-design-primer**: the most starred system design repo on GitHub. 47 topics. Encyclopedic.
2. **karanpratapsingh/system-design**: a structured course in Markdown. The widest coverage, from OSI to OAuth.
3. **Alex Xu · System Design Interview (Vol 1 + 2)**: interview oriented. Each building block is taught inside a design question.
4. **ByteByteGo**: animation plus blog. Emphasizes observability and distributed patterns.

### What each source emphasizes

**donnemartin** is strong on communication protocols and availability patterns. It treats TCP, UDP, RPC and REST as separate topics, and it is the only source that lists back pressure and task queue on their own. Weakness: no rate limiter, consistent hashing or API gateway.

**karanpratapsingh** has the widest coverage. From IP/OSI to OAuth/SSO, from CQRS to geohashing. It is the only source that covers security (TLS, mTLS, OAuth), architecture patterns (event sourcing, CQRS, EDA) and distributed theory (CAP, PACELC, distributed transactions). The price is that every topic is shallow.

**Alex Xu** stands out for teaching certain building blocks as full design questions. Rate limiter is not a paragraph; it is a whole chapter: requirements analysis, algorithm comparison, distributed deployment. The same goes for unique ID generator and key-value store. Weakness: no service discovery, reverse proxy or circuit breaker.

**ByteByteGo** is the only source that covers the operations side seriously: distributed tracing, distributed locking, distributed task scheduler, retry strategies. The other three barely touch these.

### In all four (the core 9)

All four references have these 9. If there is only time for 9, learn these.

| Building Block | One line |
|---|---|
| DNS | Name resolution. Also used for load balancing and failover. |
| CDN | Edge caching. Invalidation is the hard part. |
| Load Balancer | L4 is fast, L7 can route on HTTP content. |
| Cache | Fast reads, with the risk of stale data. |
| Message Queue | Decoupling. Exactly-once is hard to really achieve. |
| Database (SQL) | ACID. Schema. Join. |
| Database (NoSQL) | KV, document, wide column, graph. |
| Database Replication | Leader-follower, multi-leader, leaderless. |
| Database Sharding | Hash vs range. Resharding is a lot of trouble. |

### In three sources (the high-frequency 6)

| Building Block | Which three | One line |
|---|---|---|
| Consistent Hashing | karanpratapsingh, Alex Xu, ByteByteGo | Only a few keys move when nodes are added or removed. |
| Rate Limiter | karanpratapsingh, Alex Xu, ByteByteGo | Token bucket vs sliding window. Protects downstream. |
| API Gateway | karanpratapsingh, ByteByteGo, donnemartin (implied) | Single entry point. Auth offloading, routing, rate limiting. |
| Reverse Proxy | donnemartin, karanpratapsingh, ByteByteGo | The boundary with LB and API gateway is often confused. |
| Service Discovery | donnemartin, karanpratapsingh, ByteByteGo | How microservices find each other. DNS-based vs registry-based. |
| REST / RPC / gRPC | donnemartin, karanpratapsingh, ByteByteGo | Choice of communication protocol. JSON vs protobuf. |

### Unique to one source, or rare

**Only donnemartin emphasizes:**
- Back Pressure: when upstream is too fast, how downstream signals it to stop.
- Task Queue: different from a message queue. It has workers, retries and scheduling.

**Only karanpratapsingh covers:**
- OAuth 2.0 / SSO: authentication and authorization. The other sources skip it as "already known".
- CQRS / Event Sourcing: read/write separation taken to the extreme.
- CAP / PACELC: distributed theory. The other sources give it one sentence; this one gives it a section.
- Distributed Transactions: 2PC, saga.
- Geohashing / Quadtree: geographic indexing.

**Only Alex Xu teaches as a standalone chapter:**
- Unique ID Generator: Snowflake, UUID. A common interview question.
- Key-Value Store: not just "a kind of NoSQL", but a whole design question.
- Notification System: the infrastructure for push, SMS and email.

**Only ByteByteGo covers seriously:**
- Distributed Tracing: one request crosses 10 services; how to trace it.
- Distributed Locking: Redlock and the controversy around it.
- Circuit Breaker: complements the rate limiter. Circuit breaker vs rate limiter.
- Retry Strategies: exponential backoff, jitter.

### Conclusion: this gallery's building blocks list

The building blocks grid on the homepage holds the infra components (the ones drawn as boxes on a whiteboard). Patterns (consistent hashing, circuit breaker) and theory (CAP, PACELC) go into the chunks in the forest.

---

## 2.8 Building Blocks Checklist

Depth-first leaves blind spots, and this checklist is for finding them. Each row lists what I know and what I cannot answer yet.

| # | Building Block | What I know | What I cannot answer yet |
|---|---|---|---|
| 1 | DNS | Know the resolution chain: stub → recursive → authoritative. | How does DNS-based load balancing work? What is the TTL trade-off between freshness and latency? |
| 2 | CDN | Have used CloudFront for static assets. Understand edge caching. | How does cache invalidation propagate between edge nodes? What protocol? What latency? |
| 3 | Load Balancer (L4/L7) | L4 forwards packets by IP/port. L7 reads HTTP headers and routes by path/cookie. | How does consistent hashing avoid redistributing every key when a node joins or leaves? |
| 4 | Reverse Proxy | Know Nginx can be a reverse proxy. Know it overlaps with LB. | Where are the boundaries between reverse proxy, LB and API gateway? When should they be merged? |
| 5 | API Gateway | Have used Kong and Nginx. Know routing, auth offloading, rate limiting. | How does an API gateway differ from a service mesh ingress? When to use which? |
| 6 | Cache (Redis) | Used as a session store and key-value cache. | LRU vs LFU eviction: when does LFU win? How does Redis Cluster handle split-brain? |
| 7 | Rate Limiter | Understand the concept. Know it protects downstream services. | Token bucket vs sliding window log: which handles bursts better, and why? |
| 8 | Message Queue | Have used RabbitMQ for basic pub/sub. | Exactly-once delivery: real, or a useful fiction? What does Kafka actually guarantee? |
| 9 | Database (SQL) | Can write CRUD. Know an index speeds up queries. | How does the WAL guarantee crash safety? How do B-Tree and LSM-Tree differ in read and write amplification? |
| 10 | Database (NoSQL) | Know the four kinds: KV, document, wide column, graph. | In what scenario does wide column (Cassandra) beat document (MongoDB)? |
| 11 | Database Replication | Know the leader-follower concept. | How is conflict resolution done in multi-leader? How is the quorum computed in leaderless (Dynamo-style)? |
| 12 | Database Sharding | Know the word. Know it spreads data across multiple nodes. | Hash vs range partitioning: what breaks when a shard is added? How to reshard without downtime? |
| 13 | Blob Storage (S3) | Have used S3 to upload files. | How does S3 reach 11 nines of durability? What is the replication model? |
| 14 | Search (Elasticsearch) | Used for log aggregation. | How does an inverted index handle fuzzy search at scale? What is the memory trade-off? |
| 15 | Service Discovery | Know k8s uses DNS-based service discovery. | Registry-based (Consul, etcd) vs DNS-based: when to pick which? |
| 16 | Observability (Logs, Metrics, Traces) | Have used ELK to read logs. Know Prometheus scrapes metrics. | How does distributed tracing propagate context between microservices? How do the three link up for root cause analysis? |

Every "what I cannot answer yet" is an article not yet written. When an article in the gallery answers one, that row gets updated.

---

## 2.9 Two content modes: Chunks and Articles

This gallery has to give both breadth and depth, and the two need different formats.

### Chunks: breadth in a drawer

A chunk is a short explanation of one concept, shown in the side panel, scanned in 60 seconds.

Chunks live in `src/assets/chunks/`, 130 of them at the moment: `raft.md`, `b-tree.md`, `cap.md`, `mvcc.md`, `exactly-once.md` and so on. Each covers one concept only, does not trace a dependency chain, and carries no narrative.

**When to use a chunk:** reading the Kafka article you hit "partition", open the chunk for the definition, the diagram and the trade-offs, close it and keep reading.

Chunks are the dictionary.

### Articles: depth on a full page

An article traces cause and effect. Not "what is Raft" but "what breaks without consensus, how Raft solves it, and what Raft still cannot solve".

Articles live in `src/assets/articles/`. Each one follows a dependency chain down:

```
k8s → etcd → Raft → the consensus problem → network failures → clocks
Kafka → the log → replication → exactly-once → distributed transactions
Postgres → WAL → B-Tree → MVCC → isolation levels → serializability
```

**When to use an article:** you have 20 minutes and want to follow one system from the surface all the way to the root problem it solves.

Articles are the textbook.

### Why both

With only chunks, you learn 20 terms but never trace a single dependency chain. With only articles, three chains go very deep, but you cannot explain in one sentence what a CDN is.

---

## The first batch of articles

| Order | Article | Why this order |
|---|---|---|
| 1 | k8s control plane / data plane / management plane | Start where the curiosity already is. Write the part already understood first, and find what is not understood while writing. |
| 2 | etcd and Raft | k8s depends on it. Follow the dependency. |
| 3 | The Log (Kafka) | Jay Kreps's "The Log" is the foundation of streaming architecture. |
| 4 | Storage engines: B-Tree vs LSM-Tree | Databases are my shallowest area; start reading down from here. |
| 5 | Isolation levels | Needs storage engines first, and ends at the CockroachDB RFC. |
