---
title: "After kubectl apply, what happens inside k8s?"
slug: k8s-planes
date: 2026-03-09
updated: 2026-10-17
revisions: 2
subtitle: "One command goes in, and behind it six components each watch for changes and handle their own part. No component coordinates them."
chapter: "extras"
tags: [k8s, architecture, control-plane]
related: [etcd-raft, before-k8s, four-interfaces-one-pod]
---

# After kubectl apply, what happens inside k8s?

You type `kubectl apply -f deployment.yaml`, press enter, and thirty seconds later a pod is running on some node. What happened in between?

(`kubectl` itself is only an HTTP client. It packs the YAML into a REST request and sends it to the API server. Typing `kubectl get pods` in the terminal is the same as a browser doing `GET /api/v1/pods`.)

The request passes through six components: the API server, etcd, the controller manager, the scheduler, the kubelet and kube-proxy. They do not call each other, and none of them is in command. Each one watches for changes on its own and acts only on the ones that concern it.

---

## 1. API Server

The API server is the first to receive the YAML. It validates the request, checks identity, then writes the Deployment into etcd.

It does not notify the scheduler or the kubelet, and it does not know who will read this record.

The API server is stateless and keeps no state of its own. If it crashes and restarts, nothing is lost, because the data is already in etcd.

## 2. etcd: the single source of truth

etcd is a distributed key-value store, like a dictionary: the key is a path, the value is JSON:

```
/registry/pods/default/my-pod → { "spec": {...}, "status": {"phase": "Pending"} }
```

Why not Postgres? Because k8s has three requirements for its storage:

1. **Small data** — it stores cluster state, not user data. A few GB at most.
2. **Strong consistency** — two schedulers must never see different states.
3. **Efficient watch** — when data changes, every component in the cluster has to be notified.

Postgres can do 1 and 2. But 3 is not its strength.

Why not Redis? Redis is a cache: fast, but it can lose data. etcd is a bit slower, but what it returns is always committed data. If a query finds the pod, the pod exists. The cost is that once etcd stops, the whole cluster can read no state at all, and nothing in the cluster can be changed.

etcd runs on 3 or 5 nodes and keeps them in sync with the [Raft](chunk://raft) consensus algorithm. Details are in [the etcd article](article://etcd-raft).

## 3. The watch mechanism

The components here neither poll nor wait for orders. They watch for changes themselves.

The [Scheduler](chunk://scheduler) opens an HTTP connection to the API server that stays open for a long time:

```
GET /api/v1/pods?watch=true&fieldSelector=spec.nodeName=

HTTP/1.1 200 OK
Transfer-Encoding: chunked

{"type":"ADDED","object":{"metadata":{"name":"my-pod"},...}}
```

This response never ends. When a new pod with no node assigned appears in etcd, the API server pushes one line of JSON down this connection. The scheduler receives it immediately.

Technically it is an ordinary HTTP request, but the response stays open with `Transfer-Encoding: chunked`. Imagine calling the weather bureau and the person on the other end never hangs up, reading out each new forecast as it comes. No need to call back every five minutes (that is polling), and no need to switch to a different phone line (that is WebSocket).

### Watch sends differences, not the full state

Every record pushed down the watch connection is a **delta event**, with one of three types:

```json
{"type": "ADDED",    "object": {"metadata": {"name": "web-3", "resourceVersion": "4525"}, ...}}
{"type": "MODIFIED", "object": {"metadata": {"name": "web-2", "resourceVersion": "4524"}, ...}}
{"type": "DELETED",  "object": {"metadata": {"name": "web-1", "resourceVersion": "4530"}, ...}}
```

`ADDED` = newly created, `MODIFIED` = some field changed, `DELETED` = removed. Only "the one record that changed" is sent, not "the full list of 5000 pods all over again".

Inside etcd, every write (create / update / delete) adds 1 to a global version number, and the change record is stored with that version. Imagine a running ledger:

```
version 4521: Pod "web-1" created   → Pending
version 4522: Pod "web-1" modified  → Running
version 4523: Pod "web-2" created   → Pending
version 4524: Pod "web-2" modified  → Running
version 4525: Pod "web-3" created   → Pending
```

The scheduler's watch is reading this ledger. When a new line appears, the API server pushes it over.

### What if the connection drops

The `resourceVersion` on every event is the line number in the ledger. When the scheduler reconnects, it brings the last number it received:

```
GET /api/v1/pods?watch=true&resourceVersion=4523
```

"I last saw line 4523, start reading from 4524." The API server finds the records from 4524 on in etcd and sends them over. Nothing in between is missed.

But the ledger does not grow forever. By default the API server compacts etcd every 5 minutes, clearing out old versions. If the scheduler was disconnected too long and the `resourceVersion` it brings has already been cleared, the API server returns `410 Gone` ("that page has been torn out"). The scheduler then has to fetch the full pod list again, get the latest resourceVersion, and start watching from there.

```
resourceVersion still there:
  bring resourceVersion=4523 → continue with 4524, 4525...

resourceVersion already cleared by compaction:
  bring resourceVersion=4523 → 410 Gone
  → full GET /api/v1/pods (get the latest version=9999)
  → watch again with ?resourceVersion=9999
```

Every component in k8s uses this mechanism: the Scheduler watches pods not yet scheduled, the Kubelet watches pods assigned to its own node, Kube-proxy watches changes to services and endpoints, the Controller manager watches deployments, replica sets and so on.

## 4. Controller Manager

What you applied is a Deployment, not a pod. The Deployment controller sees the new Deployment and creates a ReplicaSet; the ReplicaSet controller sees the new ReplicaSet and creates pod objects to match `replicas`. Every one of these pods has an empty `spec.nodeName`. They are records in etcd, not yet running on any machine.

This layer also writes through the API server. It touches neither etcd nor the scheduler.

## 5. Scheduler

The Scheduler sees a pod whose `spec.nodeName` is empty. Its job is to pick a node.

It first filters out nodes that cannot hold the pod, for example ones without enough resources, or ones with a taint the pod has no matching toleration for. A taint is a node declaring which pods it refuses; a toleration is a pod declaring it can be placed on a node with that taint. The remaining nodes are scored by available resources and affinity rules (which pods this pod prefers to share a machine with), and the highest score wins.

The Scheduler does not contact that node. It only creates a Binding through the API server, which sets this field on the pod:

```
spec.nodeName: "worker-3"
```

The Scheduler's work ends here. It goes back to watching.

## 6. Kubelet

On worker-3, the kubelet has been watching the API server for pods assigned to its own node. It sees `my-pod` appear.

The Kubelet does not run containers itself. It calls down the chain:

```
kubelet → containerd → runc → Linux kernel (namespaces, cgroups) → container is running
```

Once the [Container](chunk://container) is running, the kubelet reports the status back to the API server. The pod's phase goes from `Pending` to `Running`.

## 7. Kube-proxy

The pod is running, but no other pod can find it yet.

A pod's IP is temporary. When a pod dies and is recreated, it gets a new IP. Scaling up from 1 to 3 replicas adds three new IPs. Having other pods track these IPs themselves is not practical.

The k8s answer is the Service, a stable virtual IP that never changes (ClusterIP):

```
Pod A → Service IP (fixed) → iptables/IPVS → Pod B-1, B-2, B-3 (changes)
```

Kube-proxy watches changes to Services and Endpoints. When a new pod joins a service, the kube-proxy on every node updates the iptables rules on its own machine. Pod A sends traffic to the Service IP, and the kernel routes it to one of the real pods. Pod A has no idea how many replicas there are or where they run.

---

## A design with no commander

Look at the whole flow once more:

```
kubectl → API server → etcd (write Deployment)
                        ↓ watch
                     Controller Manager (create ReplicaSet, then pods, write back)
                        ↓ watch
                     Scheduler (pick node, write back)
                        ↓ watch
                     Kubelet (create container, report status)
                        ↓ watch
                     Kube-proxy (update iptables)
```

No orchestrator assigns the work. The API server does no coordination; it only accepts writes and pushes watch events.

This is declarative design. What you declare is "I want 3 replicas", not "create pod 1 on node A, pod 2 on node B, pod 3 on node C". Then each component reconciles the actual state toward the target state on its own.

This design has two benefits:

**Fault tolerance.** Any component can crash and restart. If the Scheduler dies, just restart it: it watches the API server again, sees the pods still pending, and continues from where it stopped. It keeps no state of its own; everything is in etcd.

**Loose coupling.** Adding a new component needs no change to existing ones. The new component only watches the API server and handles the events it cares about. That is how later components like custom operators and service meshes all plug in through the same watch mechanism (admission controllers are the exception: the API server calls them synchronously inside the write request).

---

## Raft, Controllers, networking across nodes

**[Raft](chunk://raft)** — how [etcd](chunk://etcd) keeps 3 nodes in sync without losing data, in [the etcd article](article://etcd-raft).

**Controllers** — the reconciliation loops that manage deployments, replica sets and stateful sets. Each controller watches the desired state, compares it with the actual state, then acts. Same pattern as above.

**Networking across nodes** — how traffic between pods crosses nodes, including CNI plugins, overlay networks, and why kube-proxy may be replaced by eBPF, in [the CNI article](article://cni-network).
