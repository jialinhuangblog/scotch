---
title: "KRaft"
slug: kraft
brief: "Kafka no longer depends on ZooKeeper; it manages cluster metadata with Raft inside Kafka itself."
date: 2026-06-12
updated: 2026-10-17
revisions: 1
---

# KRaft

> Kafka always needed a separate ZooKeeper running next to it to manage metadata. Can it manage that itself?

## Kafka manages its own metadata

The cluster's metadata is information like "which brokers exist, which topics exist, which broker leads each partition". Early Kafka stored it in an external ZooKeeper, so you operated two distributed systems, with Kafka and ZooKeeper each deployed and monitored on their own, and a broker could not even start until it reached ZooKeeper.

KRaft (Kafka Raft) moves the metadata into Kafka itself. Walk through creating a topic. The cluster has 10 brokers, 3 of which also act as controllers, and those 3 elect one leader with [Raft](chunk://raft). An admin runs `kafka-topics --create --topic orders --partitions 6`, and the request goes to the controller leader. The leader does not change its memory directly. It writes a record saying "new topic orders, 6 partitions, led by these brokers" and appends it to an internal topic called `__cluster_metadata`, which is a [log](chunk://the-log). The other 2 controllers replicate the record, and once a majority (2 of 3) has written it, it counts as committed. The remaining 7 brokers read this log from the front like ordinary consumers. When they reach the record they know that orders exists and whether they lead any of its partitions.

If the controller leader dies, the other 2 elect a new one with Raft. The new leader's log is identical to the old one, so nothing has to be rebuilt from elsewhere. A restarted broker only catches up from the offset it last read, instead of pulling the whole metadata again.

Like a company that used to outsource its staff roster to another firm. KRaft is bringing the roster back in house, so there is no more coordinating with the contractor.

## What it buys

One less ZooKeeper to run, faster metadata operations, support for more partitions, faster controller failover. KRaft has been production ready since Kafka 3.3, and 4.0 removed ZooKeeper mode entirely.
