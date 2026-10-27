---
title: "Reconciliation"
slug: reconciliation
brief: "An endless loop that keeps comparing the state you asked for with the state you have."
date: 2026-04-08
updated: 2026-07-20
revisions: 3
---

# Reconciliation

k8s does not take commands. After you declare "I want 3 nginx Pods", a controller makes reality match the declaration. This ongoing compare and correct process is reconciliation.

## Loop

Every controller runs the same loop:

```text
loop:
  desired = read the spec in etcd (what you want)
  actual  = observe the current state (what is there now)
  if actual != desired:
    act to move actual → desired
  sleep → repeat
```

An example from the Deployment controller:

```text
desired: replicas = 3
actual:  only 2 Pods running

action: create 1 new Pod
```

The comparison is not a one-time thing. If a Pod dies, the next round of the loop finds actual = 2 again and adds one more.

## Why not imperative

Imperative: "start a Pod". If the network drops and the command never arrives, the Pod does not start, and there is no way to know the final state.

Declarative + reconciliation: "I want 3 Pods" is written into etcd. Whatever happens in between (network drop, node down, container crash), the controller keeps correcting the state back to 3.

## Who runs reconciliation

More than one controller. Built into k8s:

| Controller | Manages |
|---|---|
| Deployment controller | Pod replica count, rolling update |
| ReplicaSet controller | Keeps the Pod count matching the spec |
| Node controller | Detects a dead node and marks it NotReady |
| Job controller | Makes sure a Job finishes the specified number of times |
| EndpointSlice controller | Updates the list of Pods behind a Service |

Each one is the same loop with a different desired and actual:

```text
# Deployment controller
desired = Deployment.spec (replicas=3, template v2)
actual  = the ReplicaSets it manages
diff    → create a new ReplicaSet (v2), scale the old one down to 0 step by step (rolling update)

# ReplicaSet controller
desired = ReplicaSet.spec.replicas = 3
actual  = Pods with matching labels = 2
diff    → create 1 Pod (delete if there are too many)

# Node controller
desired = every node reports a heartbeat periodically
actual  = node-7 has not reported for 40 seconds
diff    → mark NotReady → past the eviction timeout, start evicting its Pods

# Job controller
desired = completions = 5
actual  = Pods finished successfully = 3, still running = 1
diff    → add 1 more Pod, until the success count reaches 5

# EndpointSlice controller
desired = list of Ready Pod IPs matched by the Service selector
actual  = the IPs currently in the EndpointSlice
diff    → add the new Pod's IP, remove the dead Pod's IP
```

The Deployment controller's actual is not Pods but ReplicaSets. It manages only ReplicaSets, and the ReplicaSet manages the Pods. Each layer runs only its own loop and delegates downward, layer by layer.

Custom controllers (operators) run the same pattern. Argo CD's sync loop, cert-manager's certificate renewal: all reconciliation.

---

This loop reads the current state; it does not wait for event notifications. Why that choice, and why missing one observation does not matter, is in [Edge vs Level Triggered](chunk://edge-vs-level-triggered).

