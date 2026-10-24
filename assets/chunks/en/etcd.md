---
title: "etcd"
slug: etcd
brief: "Distributed KV store. The single source of truth."
date: 2026-03-09
updated: 2026-10-18
revisions: 2
---

# etcd

All of k8s state lives in etcd. Every Pod, Service and ConfigMap is one key in it, such as `/registry/deployments/default/web`, and the value is the full content of that object. etcd usually runs as 3 nodes that reach agreement with [Raft](chunk://raft). Only the API server reads and writes etcd directly. A controller that needs data goes through the API server too.

## One kubectl scale, step by step

Run `kubectl scale deployment web --replicas=5` and this happens in order:

```text
kubectl → API server: set replicas of web to 5
API server → etcd leader: write /registry/deployments/default/web
leader → two followers: replicate the write
a follower replies that it is written (one is enough, two of three with the leader)
leader → API server: committed
API server → kubectl: deployment updated
```

A write counts as successful only after at least two of the three nodes have it on disk. At the moment of commit, the third node may not have received it yet, so if the node that loses power is the leader, the write may be on only one follower. The data is still not lost, because in a Raft election a node does not vote for a candidate whose log is older than its own. So the node that missed the write cannot get a majority of votes, and only the node that has it can be elected. Each node writes to its WAL (Write-Ahead Log) before replying, so a node that crashes and restarts restores from the WAL and does not come back with the old replicas 3.

## Watch

After the write succeeds, nobody polls. The deployment controller already holds an open watch on the API server, and the API server holds a watch on etcd. So the moment that key changes, the event is pushed upward, and within milliseconds the deployment controller receives "web wants 5 replicas". It does not create Pods itself. It changes the replicas of the ReplicaSet under it from 3 to 5, which is another write through the API server into etcd. The ReplicaSet controller also holds a watch, receives that change, compares it with the 3 Pods that exist, and only then creates 2 more. This watch is how the reconciliation loop hears about changes.

## Trade-offs

- Strong consistency. Raft guarantees at most one leader per term (a number that goes up by one with every leader election), but when the network splits in two, the old leader cut off on the minority side may still believe it is the leader. It cannot get replies from a majority, so its writes cannot commit. etcd reads are linearizable by default: before replying, the leader confirms with a majority that it is still the leader, so the old leader does not return stale data either
- A write needs a majority, so it is slower than a single node KV store; one write usually takes a few milliseconds
- Not meant for large data: the default storage limit is 2GB and the official advice is to stay under 8GB, so container logs never go here
