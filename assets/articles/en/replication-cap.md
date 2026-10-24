---
title: "The data is replicated. Now, is it consistent?"
slug: replication-cap
date: 2026-03-16
updated: 2026-10-17
revisions: 2
subtitle: "It is all called 'replication', but underneath there are three architectures, and each gives a different consistency guarantee."
chapter: "storage"
tags: [replication, cap, consensus, quorum, distributed-systems]
related: [storage-deep, storage-internal, etcd-raft, scaling-first-move, cap-cache-acid]
---

# The data is replicated. Now, is it consistent?

One DB holds all the data. That machine goes down, and the data is gone.

The obvious fix is to [replicate](chunk://replication) the data to several machines. One goes down, the others still have it.

But behind the word "replication" there are three completely different architectures. Writes, reads, and what happens when a node goes down all work differently in each.

---

## Architecture one: Leader-Follower

One leader handles every write. Followers copy data from the leader and only accept reads.

MySQL, PostgreSQL and [Aurora](chunk://aurora) all use this architecture. MongoDB has the same topology, but by default its writes wait for a majority to confirm. The note after the failover table below covers this.

### How a write goes

```text
Client → Leader → write succeeds → replicate to Follower 1, Follower 2
```

Writes only go to the leader. The leader can reply to the client as soon as its own write is done (asynchronous replication), or wait for follower confirmation (synchronous replication). Most systems default to asynchronous. It is faster, but if the leader goes down, the last few writes that have not reached a follower yet are lost.

### How a read goes

Reading from the leader always returns the latest value. Reading from a follower may return a stale value (replication lag).

Aurora offers two endpoints: the writer endpoint connects to the leader, the reader endpoint to a follower. The application decides which endpoint each query uses.

Lag causes a real problem. A user posts an article (written to the leader), then refreshes the page right away (read from a follower). The follower has not received that row yet, so the user cannot see the article they just posted. The fix is called read-after-write consistency: the next read of data that was just written is forced to the leader. Every other read goes to a follower as usual.

### What happens when a node goes down

A follower goes down: no effect, just one less machine sharing the read load. When it comes back, it catches up on what it missed from the leader.

The leader goes down: a new leader has to be elected (failover). No writes during the election.

How does the election run? Take Raft as the example. The leader sends a heartbeat to the followers at regular intervals. If a follower goes too long without a heartbeat, it decides the leader is dead, starts an election, votes for itself, and asks the other followers for their votes. A majority wins.

But if three followers notice the dead leader at the same time and all start elections at once, each votes for itself, nobody gets a majority, and the election fails. So Raft gives each follower's timeout a random extra (for example 150-300ms). The first to time out starts first. The others have not timed out yet, there is no competitor, so they vote for it.

```text
Follower A times out at 150ms → starts the election first → gets the majority → elected
Follower B times out at 280ms → A is already elected, no election needed
Follower C times out at 290ms → same
```

| Product | Failover method | Time |
|---|---|---|
| MongoDB | Raft style vote, new primary elected automatically | seconds |
| MySQL | manual switch, or automated with MHA / orchestrator | seconds to minutes |
| PostgreSQL | manual promote of a standby, or automated with Patroni | seconds to minutes |
| Aurora | AWS detects and promotes a replica automatically | about 30 seconds |

MongoDB sits in this table because a replica set has the same topology as MySQL: one primary takes writes, and the secondaries copy from it. The difference is when the primary answers the client. MongoDB's default write concern is majority, so the primary waits for a majority of nodes to confirm before it reports success [SRC: mongodb.com/docs/manual/reference/mongodb-defaults/], and the new primary is chosen by a Raft style vote. By the "who has the final say" rule in architecture two below, MongoDB's writes are closer to consensus.

MongoDB and Aurora have automatic failover built in. MySQL and PostgreSQL do not automate it natively; they need extra tooling. Aurora runs no election. When AWS detects the writer is down, it promotes one replica. The official recovery time is "typically less than 60 seconds, often less than 30 seconds". The application side also has to wait for the cluster endpoint's DNS to point at the new writer: AWS states that RDS Proxy bypasses the DNS cache and can cut failover time by up to 66% [SRC: docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Concepts.AuroraHighAvailability.html].

### Consistency guarantee

Read the leader = strong consistency. Read a follower = eventual consistency (with lag).

### Variant: Multi-Leader

Several nodes accept writes and sync with each other. It fits deployments across regions (one leader in Tokyo, one in New York). The problem is that two leaders changing the same row at the same time conflict, so a conflict resolution strategy is needed. CouchDB uses this. So do DynamoDB Global Tables: one leader per region, syncing with each other across regions.

---

## Architecture two: Consensus (Raft)

There is still a leader, but a leader's write only succeeds once a majority has confirmed it.

etcd and TiKV use Raft. ZooKeeper uses ZAB, which is similar.

### How a write goes

```text
Client → Leader → replicate log to Follower 1, Follower 2
                → 2/3 confirm (leader included) → reply to Client "success"
```

The leader cannot decide alone. It has to wait until a majority of followers confirm they received the log entry. Only then is the write committed.

Here quorum (majority vote) shows up again. Quorum is not an architecture. It is a counting rule: "enough people have to agree before it counts". Different architectures can use it:

- **Consensus (Raft) uses quorum**: after the leader writes, it waits for a majority of followers to confirm, which guarantees a consistent log order → strong consistency
- **Leaderless also uses quorum**: there is no leader, any node writes and waits for W confirmations, which only guarantees "the latest value can be read" → eventual consistency

Both are called quorum, but Raft's quorum confirms "log order" and Leaderless quorum confirms "the data arrived". The level of consistency differs.

This is the difference from architecture one. Leader-Follower defaults to asynchronous replication: the leader replies to the client as soon as its own write is done, without waiting for followers. A Raft leader waits for a majority before replying.

### How a read goes

Every node has exactly the same log order. But a follower may not have applied the last few committed entries yet, so etcd's default read is linearizable: before responding, the node confirms the latest commit position with the leader and makes sure it has caught up.

### What happens when a node goes down

3 nodes, 1 down: the majority is still there, keep running. 5 nodes, 2 down: the majority is still there, keep running.

The leader goes down: followers start an election, random timeouts break ties, and a new leader is elected within a few hundred milliseconds.

Once more than half the nodes are down (2 out of 3), the cluster stops serving. Without a majority to confirm, writes cannot commit. Raft is designed to stop responding at that point rather than return data that may be stale.

### Consistency guarantee

Strong consistency. Every node has the identical log order, so replaying it gives the identical state. The cost is higher write latency (waiting for the majority), and the cluster stalls if too many nodes go down.

### Same Leader-Follower topology, different classification

Draw the architecture of etcd and Redis and the diagrams are identical: one leader, several followers.

**Topology** describes "who connects to whom". In both, the leader writes and followers copy.

**Classification** describes "who has the final say". An etcd leader cannot decide on its own; a majority of followers has to agree, so it is called consensus. A Redis leader decides on its own, and followers just passively follow, so it is classified as leader-follower.

```text
etcd:   Client → Leader → wait for majority of Followers to confirm → then reply success to Client
Redis:  Client → Leader → reply success to Client right away → replicate to Followers in the background
```

| | Topology | When the client gets the reply | Leader goes down | Classification |
|---|---|---|---|---|
| etcd | leader-follower | after a majority of followers confirm | no data lost, new leader elected safely | Consensus |
| Redis | leader-follower | as soon as the leader's own write is done | recent writes may be lost | Leader-Follower |

k8s stores cluster state in etcd (it must never be lost). Redis is used as a cache (losing it means at worst a cache miss and one more query).

---

## Architecture three: Leaderless

No leader. Every node accepts both reads and writes.

Cassandra and Riak use this architecture. The design comes from Amazon's 2007 Dynamo paper. The DynamoDB service on AWS today has a similar name, but each partition has a leader inside, so it does not count as leaderless.

### How a write goes

```text
Client → write to Node A, Node B, Node C at the same time
       → W=2 confirmations → write succeeds
```

There is no fixed leader. The client (or a coordinator node) sends the write to several nodes and counts it as a success after W confirmations.

### How a read goes

```text
Client → ask Node A, Node B at the same time
       → two responses → pick the newest version
```

The client asks R nodes, may get different versions of the data, and picks the newest.

W + R > N (the total number of nodes) guarantees that at least one of the nodes read took part in the most recent write. Mathematically the two sets always overlap.

W and R are two settings you can tune yourself. Higher (toward W=R=N) leans toward consistency, so you read what was just written. Lower leans toward speed and availability. But no setting gives the strong consistency of consensus. That is a limit of the leaderless architecture itself.

### What happens when a node goes down

No election needed. Any number of nodes can go down and the cluster keeps running, as long as W nodes can still take writes and R nodes can still serve reads. Only when so many are down that W or R cannot be reached does that operation fail.

### Consistency guarantee

Eventual consistency. Different nodes may hold different values for a while. A read uses the quorum to piece together the latest value, but order is not guaranteed. Two clients writing the same row at the same time can conflict, so a conflict resolution strategy is needed (for example last-write-wins).

At the moment of the write, each node acts independently. Afterwards, background mechanisms slowly bring them back to agreement:

- **gossip**: nodes exchange state with each other on a schedule
- **read-repair**: when a read finds the replicas out of sync, it pushes the newer version to the stale ones
- **hinted handoff**: when the target node is down, another node takes the write on its behalf and hands it over once the target is back

### Why an RDB (relational database) does not use Leaderless

An RDB needs transactions (ACID). A transaction requires "these three writes all succeed or all fail", which needs strict ordering control. A leaderless architecture has no single order. Each node takes writes on its own, so there is no way to coordinate a transaction's commit or rollback.

That is why MySQL, PostgreSQL and Aurora are all Leader-Follower: every write passes through the same leader, and the leader owns the transaction order. Leaderless is used where transactions are not needed, for example storing logs in Cassandra.

---

## Strong consistency vs eventual consistency

**Strong Consistency**: once a write succeeds, anyone reading from any node gets the latest value. It behaves as if there were only one machine.

**Eventual Consistency**: once a write succeeds, for a short time some nodes have not received it yet. After a while (usually milliseconds to seconds), every node ends up in sync.

```text
Strong consistency:
  T=1  write name="Carol"
  T=2  read from any node → always "Carol"

Eventual consistency:
  T=1  write name="Carol"
  T=2  Node A read → "Carol" (synced)
       Node B read → "Bob" (not synced yet)
  T=3  Node B read → "Carol" (sync complete)
```

The cost of strong consistency is speed (waiting for the majority). The cost of eventual consistency is a brief inconsistency (a user may see a stale value).

Most user-facing scenarios can accept eventual consistency. If other people see a social post a few seconds late, nothing is lost. A bank transfer cannot: once the money is deducted, the other side must see it immediately.

---

## The three architectures side by side

| | Leader-Follower | Consensus (Raft) | Leaderless |
|---|---|---|---|
| Representative products | MySQL, Aurora, MongoDB | etcd, ZooKeeper, TiKV | Cassandra, Riak |
| Who takes writes | Leader | Leader (waits for majority) | any node (waits for W confirmations) |
| Who serves reads | Leader or Follower | any node (usually the Leader) | any R nodes |
| Leader goes down | failover elects a new leader | vote elects a new leader | not needed, there is no leader |
| Consistency | strong on the leader, eventual on followers | strong | eventual |
| Where quorum is used | not used | write confirmation | both reads and writes |
| Fits | general web applications | metadata that needs strong consistency (k8s state, config) | heavy write volume, cross region |

MongoDB sits in the Leader-Follower column by topology, with two exceptions. For "who handles writes" and "where quorum is used", read the Consensus column: the default write concern is majority, so a write waits for a majority to confirm. For "consistency", it depends on `readPreference`: `primary` always reads the latest value, `secondary` may read an old one.

---

## CAP: when the network splits, you pick one side

Once data is replicated to several machines, it is a distributed system. The [CAP](chunk://cap) theorem states that a network split, where nodes cannot reach each other (Partition), will happen, and when it does you can only have one of Consistency and Availability.

### CP: refuse service to stay consistent

Raft is CP. 3 nodes, 2 down, 1 left, which is less than a majority, so writes are refused. The whole system stalls, but inconsistent data never appears.

etcd, ZooKeeper and MongoDB (with `readPreference` at its default, `primary`) are all CP. Setting MongoDB to `secondary` does not make it AP. Only the primary still takes writes, so the minority side still accepts no writes, and reads may return an old value. So it fits neither CP nor AP.

### AP: stay available and allow inconsistency

Cassandra with writes at consistency level ONE is AP. The nodes are cut off from each other, and each one keeps accepting reads and writes on its own. The data may be inconsistent, and it is synced and repaired once the network recovers.

DynamoDB's eventually consistent read and DNS are often called AP, but they are the same case as MongoDB reading from a secondary above. In DynamoDB only the leader of each partition accepts writes, and a DNS record changes only at its source. During a partition the minority side accepts no writes, and reads may return stale values, so they fit neither CP nor AP.

### And Leader-Follower?

Reading Aurora's writer endpoint is CP. Reading the reader endpoint is the same case again: only the writer accepts writes, and a reader answers from its own copy, which may be stale but never stops, so it fits neither CP nor AP. The same Aurora cluster lands in different places, depending on which endpoint a query uses.

---

## Back to the opening question

"The data is replicated. Now, is it consistent?"

- **Leader-Follower**: read the leader and it is consistent, read a follower and it may not be. Simple, and enough for most scenarios.
- **Consensus**: every node is consistent. The cost is speed and a limit on fault tolerance (too many down and it stops). Fits scenarios where no divergence is acceptable.
- **Leaderless**: fast, high fault tolerance, weakest consistency. Fits heavy write volume where a brief inconsistency is acceptable.

Most systems start with Leader-Follower. Only when an inconsistency actually causes a loss is it worth switching to consensus. Only when the write volume is more than one leader can handle does leaderless come up.
