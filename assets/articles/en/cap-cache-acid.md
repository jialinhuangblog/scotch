---
title: "How do CAP, cache strategies and ACID relate?"
slug: cap-cache-acid
date: 2026-10-17
subtitle: "Does Read-Through mean Redis queries the DB? Is an RDB always CP? Do you have to choose between CAP and ACID? Which layer each of these questions belongs to."
chapter: "storage"
tags: [cap, cache-strategies, acid, pacelc, replication]
related: [replication-cap, cache-hot-key]
---

CAP, cache strategies and ACID often get discussed together, sometimes even drawn as one picture: Write-Through and Write-Around in the C corner of the CAP triangle, Write-Behind in the A corner, Cache-Aside and Read-Through somewhere in the middle. It looks tidy. Ask a few follow-up questions and several parts stop fitting.

## Q: Does Read-Through mean Redis queries the DB itself?

A: No. Redis as most people run it does not query the DB. Redis without modules knows nothing about the Postgres next to it. It has no connection settings and no schema. On a GET with no value it returns nil, and that is all.

So when Read-Through says "the cache fetches it", who is doing the fetching? Start with what Cache-Aside looks like:

```python
# Cache-Aside: the miss handling lives in business code
def get_user(id):
    v = redis.get(f"user:{id}")
    if v is None:
        v = db.query("SELECT * FROM users WHERE id = %s", id)   # the app queries the DB itself
        redis.set(f"user:{id}", v, ex=1800)
    return v
```

The app holds two connections, one to Redis and one to the DB. On a miss it queries and refills on its own. Read-Through moves the same logic into a cache class, and business code talks only to that class:

```python
# Read-Through: the same logic moved into the cache layer
class ReadThroughCache:
    def __init__(self, redis, loader):
        self.redis = redis
        self.loader = loader               # "how to query the DB", given once

    def get(self, key):
        v = self.redis.get(key)
        if v is None:
            v = self.loader(key)           # on a miss, this layer queries the DB
            self.redis.set(key, v, ex=1800)
        return v

users = ReadThroughCache(redis, loader=lambda k: db.query("SELECT ...", k))

def get_user(id):
    return users.get(f"user:{id}")         # no DB in business code anymore
```

Redis is identical in both. The only difference is the DB query line, which moved from `get_user` into `ReadThroughCache`. So the "cache" in Read-Through is this extra layer in front of Redis, not the Redis server. Spring Cache, Caffeine's LoadingCache and the Hibernate second-level cache all ship the "query the DB on a miss" layer as a library. They differ in where the data lives: Caffeine keeps it in the app's own memory and does not need Redis at all. The layer can even run inside Redis. RedisGears has ready-made recipes: rgsync syncs Redis writes to MySQL, and rghibernate also does read-through. But that is Redis with a module installed, not the plain key-value Redis most people use.

The layer can also be its own service. DAX in front of DynamoDB works this way. The app only knows the DAX endpoint and never constructs a DynamoDB client. On a miss, DAX fetches from DynamoDB itself. The app cannot tell a hit from a miss, it only notices that this call was slower. As a restaurant analogy: Cache-Aside is checking your own fridge and going to the store if it is empty. Read-Through is ordering at the counter, and if the counter is out it restocks without the customer knowing.

Writes split the same way:

```text
Write-Through  app writes cache → cache writes DB synchronously → ack only when both succeed
Write-Behind   app writes cache → ack right away → cache writes back to DB later, in batches
Write-Around   app writes DB directly, skips cache (deletes a stale value if present) → next read misses and refills
```

In Write-Through and Write-Behind the cache layer takes the write and then writes the DB, so they need that layer too. Write-Around has the app write the DB itself. A Cache-Aside write is usually "write the DB, then delete the cache key", which is Write-Around plus one delete. Put together, what separates the five strategies is who holds the DB connection:

```text
the cache layer holds the DB connection (inline)    Read-Through, Write-Through, Write-Behind
the app holds the DB connection (aside)             Cache-Aside, Write-Around
```

This is why Read-Through so often comes with Write-Through, and DAX does both: once there is a layer that connects to the DB, reads and writes both go through it. Cache-Aside usually pairs with "write the DB, then delete the key", and Redis with MySQL almost always looks like that. The 60-second version of all five is in [Cache Strategies](chunk://cache-strategies).

## Q: Then can cache strategies go into the CAP triangle?

A: Not really. The three letters of CAP describe how several replicas react when the network splits. A cache strategy decides when two copies, cache and DB, get synchronized. The two are asking different questions.

They are not unrelated, though. Bring ACID in as well and the three sit on three layers, separated by how many copies of the data there are:

```text
inside one DB, WAL ↔ data page     ACID's D        WAL hits disk at commit, data page written later
cache ↔ DB, two copies              cache strategy  sync / async / who fetches
replica ↔ replica, many copies      CAP, PACELC     C or A during a partition, L or C in normal time
```

The top layer has two copies too. At commit, the DB acks once the WAL is on disk, and the actual data page is written later. If it crashes in between, the restart replays the WAL. So all three layers answer the same question: with two or more copies of the data, which copies were waited for before the ack, and which copy takes over after a crash. If the copy that takes over was waited for, no data is lost. If it was not, data can be lost. The WAL row is the first case: the DB waits only for the WAL, and a restart recovers from that same WAL. Write-Behind is the second: it waits only for the cache copy, but that copy is in memory and gone after a crash, so the DB, which was never waited for, takes over. Where CAP and cache strategies actually meet is these two rows:

```text
sync    Write-Through  ≈  sync replication (Postgres remote_apply)   slow, both copies updated at ack
async   Write-Behind   ≈  async replication (async replica)           fast, a stale window, data lost if it dies in between
```

In the sync row both copies were waited for, so whichever takes over, nothing is lost. The async row pairs with Write-Behind because in both, the copy that takes over was never waited for. An async primary waits only for its own WAL, and when it dies the replica takes over, which was never waited for. With Write-Behind, the cache dies and the DB takes over.

With Write-Through, both cache and DB hold the new value at ack time, and the cost is that every write waits for both. That guarantee only covers the moment of the ack. If the cache write succeeds and the DB write fails, the write is not acked, yet the cache has already changed; the ACID section comes back to this. And if two clients update the same key at once, cache and DB may apply the writes in different orders. Postgres needs the right setting too: `synchronous_commit = on` only guarantees the standby flushed the record to disk, so a query on the standby may not see it yet. `remote_apply` waits until the standby has applied it. Write-Behind writes fast and can merge a hundred increments into one write, but if the cache dies before writing back, those increments are gone. That is why like counts and view counts suit it.

So Write-Through in the C corner and Write-Behind in the A corner point the right way. What they match is the ELC half of PACELC: in normal time with no partition, pick Latency or Consistency. The P half of CAP has only one loose match in a cache setup. The link between cache and DB goes down, Write-Through writes fail, which leans C. Write-Behind keeps accepting, which leans A.

The other three strategies do not fit. The picture at the top puts Write-Around in the C corner too, presumably because "it writes the DB directly, so it is the most consistent". But it skips the cache. Unless the old key is deleted, the cache keeps the stale value, which makes reads the least consistent of the five. Cache-Aside and Read-Through are about who fetches on a miss, which says nothing about consistency or availability. When a pile of misses hits the DB at once, that is a separate problem, covered in [When do requests bypass the cache and query the DB directly?](article://cache-hot-key).

## Q: Is RDB CP and NoSQL AP?

A: Half wrong, half roughly right, and the reason has nothing to do with SQL. NoSQL has both CP and AP systems, so "NoSQL is AP" does not hold. An RDB is almost never AP, but it is not always CP either: Postgres with sync replication and every read and write going to the primary is CP, while Postgres that allows reads from a standby fits neither CP nor AP. Where a system lands depends on how replication is designed, which is the bottom layer of that picture.

Start with the smallest case. Two replicas, the network between them is cut, and a client writes to one of them.

- Pick C: refuse the write, or let only the side that can reach a majority accept it. Every read returns the same version. The cost is that roughly half the nodes can only answer with an error.
- Pick A: both sides accept, both keep serving, and they merge after the network heals. The cost is that during the split the two sides return different values.

There is actually a third case, and it is common. In many systems the two replicas are not equal. Only one is the leader, and every write goes through it. The other is a follower: it copies data from the leader and holds a full copy of its own. When the network is cut, both machines are still running. Only the link between them is gone.

Say the network is cut at 10:00:00. At 10:00:05 someone on the leader's side changes a balance from 100 to 80, and that change cannot reach the follower. At 10:00:10 a client that can only reach the follower shows up. The follower's side cannot reach a majority, so it is the "minority side":

- Write: the follower knows it is not the leader and refuses the write, so this is not A.
- Read: the follower answers 100 from its own copy, but the correct value is already 80, so this is not C either.

A side that refuses writes and returns stale reads fits neither CP nor AP, so the table below gives it its own row. etcd, ZooKeeper, MongoDB, DynamoDB and Postgres are different systems, but all of them replicate with one leader and a few followers. After the cut, if the followers on the minority side still answer reads from their own copy, the system lands in this row. If they stop answering reads too, or can guarantee that what they return is still current, it is CP.

[CAP](chunk://cap) is about multi-node systems. A single-node Postgres has no second node to be cut off from, so it is out of scope. Once there is a replica, C or A becomes a question of [replication](chunk://replication) settings.

Why is NoSQL so often taken to be AP, then? It goes back to who the systems were built for. The Dynamo paper's customer was the shopping cart: "add to cart" must succeed no matter what, even with two data centers cut off from each other, so it picked A and merged conflicts afterwards. ZooKeeper is the opposite. Its customer was locks and config, and two nodes giving different answers to "who holds the lock" is an outage, so writes such as taking a lock need majority agreement, and the minority side would rather fail them. In normal operation, however, ZooKeeper's reads do not guarantee the latest value. A client reads from the server it is connected to, and that server may not have received what the leader just wrote. The official docs also say outright that reads are not linearizable, which means a read is not guaranteed to see the latest write. Once the network is cut, though, a server that loses the majority stops answering clients, reads included, so during a partition it is still CP. The official docs say that with read-only mode turned on, that server lets clients that ask for read-only access connect. A local test on 3.8.4 showed that read-only mode alone is not enough: the client was disconnected as soon as it connected. With `localSessionsEnabled=true` and `localSessionsUpgradingEnabled=true` added on all three servers, the cut-off server answered a read from its own copy with the old value and refused a write with "Not a read-only call". ZooKeeper set up this way lands in the row that fits neither CP nor AP.

Dynamo and AWS's later DynamoDB are two different systems, though. DynamoDB's 2022 paper says it shared most of Dynamo's name but little of its architecture. DynamoDB splits data into many pieces, and each piece is called a partition. That is a split of the data, not the network partition CAP talks about. Each partition has its own group of replicas, which elect one leader with Multi-Paxos, a consensus algorithm. Writes go only to the leader, so this is the same one leader plus a few followers setup as above.

So when the network is cut, a single-Region DynamoDB behaves like the balance example above: the follower's side cannot take writes. Reads come in two kinds. With strongly consistent reads, reads also go only to the leader, so the follower's side cannot read either. That is CP. With eventually consistent reads, a follower answers from its own copy, which may be stale, so it lands in the row that fits neither CP nor AP. In normal time, with no partition, the benefit of eventually consistent reads is speed, because any replica can answer.

What does accept writes on both sides is cross-Region global tables. The default MREC mode lets every Region write, and when the same item is changed in two Regions at once, the later write is kept. This is called last writer wins, and it is AP. The other mode, MRSC, waits until the write reaches another Region before returning, which is CP again.

The table below places every system by the same question: when the network is cut, how does the minority side handle writes and reads. The same system lands somewhere else once you change how it reads or writes, so the parentheses name the setting.

| During a partition | NoSQL | RDB |
|---|---|---|
| CP: minority refuses writes, every read returns the latest value, and a node that cannot give the latest value does not answer | etcd (default reads), ZooKeeper (default), MongoDB (readPreference primary), DynamoDB (strongly consistent reads; global tables need MRSC) | Postgres (sync replication, all reads and writes to the primary), CockroachDB |
| Neither: minority refuses writes but still answers reads, which may be stale | etcd (serializable reads), ZooKeeper (read-only mode plus local sessions), MongoDB (readPreference secondary), DynamoDB (eventually consistent reads) | Postgres (reads allowed on a standby, sync or async alike) |
| AP: both sides accept writes | Cassandra (writes at ONE: one replica responding is enough), DynamoDB global tables (MREC) | rare, reason below |

The read settings in parentheses all come down to reading the leader or reading a follower. Think of a chain shoe store. The master inventory lives at head office, and each branch only has a stock sheet printed from head office that morning. When a customer asks a branch whether a pair is in stock, the clerk can phone head office: the answer is always current, but it costs a phone call, and if the line is down the clerk cannot answer. Or the clerk can read the sheet: the answer is fast and still works with the line down, but head office may have sold the last pair ten minutes ago. etcd's default read (a linearizable read) is the phone call; a serializable read is the sheet. A local test with three etcd members, two of them stopped, showed exactly this: the remaining member answered a serializable read with the value from before the stop, while the default read and a write both timed out. MongoDB's primary and secondary are head office and the branch. ZooKeeper also reads from the connected server in normal operation, but by default it stops answering once it is cut off.

The AP cell for RDB is nearly empty, and Postgres shows why. When the network is cut, a Postgres primary with sync replication cannot get a reply from the standby, so writes hang and never return, which amounts to refusing them. If every read and write goes to the primary, a client on the standby's side gets nothing at all. That is CP. But a standby can also run as a hot standby that serves read-only queries, and it keeps answering after the cut. The official docs only promise causal consistency for `remote_apply`, and say nothing like it for `on`, not that every read sees the latest value, so this is the balance example again, fitting neither CP nor AP. Setting `synchronous_commit` to `on` or `remote_apply` makes no difference during a cut. As covered earlier, the difference shows up in normal reads from a standby: `remote_apply` waits until the standby has applied the write, so a read right after the write already sees the new value.

Switch to async replication and it is tempting to call it AP, but it is not. Failover tools such as Patroni demote the primary to read-only as soon as it cannot update the leader lock in etcd or a similar coordination service, so during a partition only one side accepts writes, not both. What async gives up is something else: when the primary dies and the replica is promoted, the last few writes on the primary that had not been replicated are gone, even though the client was told "write succeeded". That is closer to losing durability, and it fits neither CP nor AP.

There are RDBs that stand on CP by design, such as CockroachDB. A write needs a majority of replicas to agree, so after a cut the minority side cannot accept writes. The node on the minority side that holds the lease can answer reads only until its lease expires, and during that time nobody else can get the lease or write new data, so its reads are still current. Its own blog calls it CP.

So why do RDBs so rarely land on AP? Probably because of what they need: unique keys, foreign keys and transactions all require every write to fall into one order. If both sides of a partition kept accepting writes, each side might register a user with the same email, and once the network heals the unique key cannot survive the merge. So RDB replication usually lets only one node accept writes, and that follows from those needs, not from SQL.

And most systems are tunable. Cassandra with writes at ONE is AP; switch both reads and writes to QUORUM, meaning a majority of replicas must respond, and the official docs say the write will be visible to the read, which leans C, at the cost that the minority side can no longer write either. MongoDB moves from CP to neither when `readPreference` changes from primary to secondary. DynamoDB makes you choose MREC or MRSC when you create a global table, and lets you choose strongly consistent or not on each read. What each of the three replication architectures guarantees is laid out in [With data copied to several machines, do reads get new or old data?](article://replication-cap).

## Q: Do you have to choose between CAP and ACID?

A: No. They sit at the top and the bottom of that picture, on different layers. [ACID](chunk://acid) is the guarantee for one transaction inside one DB. CAP is a trade-off you only face when there are several replicas and the network splits. The Postgres from earlier, with sync replication and every read and write going to the primary, has both: every transaction is still ACID, and it picks C during a partition.

The two C's are also different words. ACID's C is "after the transaction, the data still satisfies the rules you defined", such as a balance never going negative or a foreign key existing. CAP's C is "every replica returns the same latest value".

Does the middle layer, cache strategy, ever touch ACID? Normally not. It comes up in about two places:

- Write-Behind gives up ACID's D. At ack time the data exists only in the cache's memory, not yet in the DB. [Redis persistence](chunk://redis-persistence) with AOF recovers part of that, and how often to fsync is yet another trade-off.
- Cache and DB cannot be in one transaction. Write-Through writes the cache, the DB write fails, and the cache already holds the new value. The usual fix is to write the DB first and then touch the cache, or to delete the key instead of updating it. Doing that reliably is the [outbox](chunk://outbox-pattern) pattern.

If you really want a term to compare side by side with ACID, the one to reach for is BASE (Basically Available, Soft state, Eventually consistent), not CAP. The term first appeared in a 1997 SOSP paper on cluster-based network services, set against ACID. The 2008 ACM Queue article "BASE: An ACID Alternative" then spread it, framing it as a different approach from ACID, and the name happens to be the chemical opposite of acid. It describes how AP systems behave: they keep answering during a partition, the data is inconsistent for a while, and it converges to one copy later.

## Q: So how do you choose in practice?

A: Take a SaaS backend with Postgres and Redis, 70% writes. Each device reports every 5 seconds, and each report writes two places: one new row in the events table, and an update to that device's latest status, such as last seen time and how many times it reported today. A dashboard reads the latest status of every device every 10 seconds. There are also user settings, read often and written rarely.

The first step is usually Cache-Aside for everything: reads check Redis first, writes go to the DB and then delete the key. After a while the Redis hit rate turns out to be low. The problem is the device status keys, which are both read and written. Each device deletes its key every 5 seconds, the dashboard reads only every 10 seconds, so by the time the dashboard reads, the key has already been deleted. Nearly every read misses and goes back to the DB. The events table is not the problem: a newly inserted row was never in the cache, and only reports read it.

So the second step is handling the data separately. Events move to Write-Around: straight into Postgres, never through Redis. User settings are read often and written rarely, so they stay Cache-Aside. Device status moves to Write-Behind: each report overwrites the last seen time in Redis, and the count goes up with INCR on a separate "not yet flushed" delta. Once a minute a flush takes the delta out with GETDEL, which also clears it, adds it to the row in Postgres, and overwrites the last seen time there. The count on the dashboard is the Postgres value plus the delta still in Redis.

The flush writes only the delta because of what happens when Redis restarts. If it wrote the whole total from Redis back to Postgres every minute, INCR would start from 1 after a restart, and the next flush would overwrite a whole day's count in Postgres with 1.

In the third step, the cost of Write-Behind shows up. Redis restarts once and the unflushed delta for that minute is gone, so today's count is short by at most one minute of reports. The last seen time loses almost nothing, since the next report fills it in 5 seconds later. With AOF and fsync set to everysec, the Redis docs say about one second of data may be lost, and the team accepts that, because these numbers feed a dashboard, not billing. If the number were used for billing, Write-Behind would be off the table: back to writing the DB directly, or turn each increment into an appended event and sum later.

When should this be revisited? Probably when the flush interval keeps getting longer to save DB writes, and one day someone makes a decision on this number that cannot be wrong. At that point the number needs ACID's D: it has to be on disk before the ack, and Write-Behind cannot do that.
