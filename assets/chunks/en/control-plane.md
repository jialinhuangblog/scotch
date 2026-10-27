---
title: "Control Plane"
slug: control-plane
brief: "API server, scheduler, controller-manager. Every k8s decision happens in this layer."
date: 2026-03-09
updated: 2026-10-18
revisions: 2
---

# Control Plane

There is no single commander in the control plane. Each component watches the state in [etcd](chunk://etcd) through the API server. etcd is the key-value store holding all cluster state, and whichever component sees a change that concerns it handles it on its own.

## Who one apply passes through

Walk through `kubectl apply` of an nginx Deployment with replicas: 3.

```text
kubectl → API server: authenticate, authorize, write the Deployment into etcd
Deployment controller sees a new Deployment → writes a ReplicaSet into etcd
ReplicaSet controller sees 3 Pods wanted, 0 present → writes 3 Pods into etcd, nodeName empty
Scheduler sees 3 Pods with no node → scores every node, fills in nodeName, writes back
kubelet on node-2 sees a Pod assigned to it → asks the container runtime to start nginx
```

None of the five roles calls another directly. Each step is the same move: see what appeared in etcd, write down your own decision. The Scheduler does not start the Pod; it only fills in nodeName. The kubelet does not care whether a Deployment exists; it only checks whether a Pod is assigned to it. The first four steps happen in the control plane. The last one, the kubelet together with kube-proxy on the node, is the data plane, the place where Pods actually run.

## The three core components

The **API Server** is the only entry point that reads and writes etcd; every read and write above goes through it. The **Scheduler** does one job: pick a node for Pods that have none. The **Controller Manager** is a collection of controllers. The Deployment controller and the ReplicaSet controller both live here, and every controller runs the same loop: read the desired state, compare it with the actual state, act if they differ, then read again.

## What this design buys

Someone deletes one of the nginx Pods. On its next pass the ReplicaSet controller sees 3 wanted against 2 present and writes another Pod into etcd. Nobody had to notify it. The same holds when a control plane machine dies: all state is in etcd, a new machine comes up and continues comparing from where the last one left off. That holds only if etcd does not disappear together with the machine. kubeadm by default puts etcd on the same control plane machine as the API server, so the HA setup runs 3 control plane machines, each with its own etcd member: lose one and two remain, with all the data. In a cluster with a single control plane machine, etcd lives on that machine too, and when its disk fails, the state goes with it.

The cost is that every component trusts only this one copy of the state in etcd. A 3 member etcd reaches consensus with Raft: lose one machine and the other two are still a majority, so reads and writes go on. Lose two and the last one is not a majority, so the API server can neither read nor write and the whole control plane stops. Pods already running on the nodes are unaffected, but no new decision can be made.
