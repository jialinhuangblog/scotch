---
title: "Data Plane"
slug: data-plane
brief: "Kubelet and kube-proxy. Where Pods actually run."
date: 2026-04-08
updated: 2026-10-17
revisions: 1
---

# Data Plane

The control plane decides which node a Pod runs on. The data plane runs the Pod on that node. Every worker node runs a kubelet and a kube-proxy.

## Kubelet

The agent on every node.

1. **Watch the API server**: check for Pods assigned to this node
2. **Start the Pod**: call the container runtime (containerd, CRI-O) through [CRI](chunk://cri-cni)
3. **Report status**: send heartbeats and Pod status back to the API server on a schedule

Kubelet does not care what runs inside the container. It only makes sure the container lifecycle matches the spec.

```text
API Server → "node-3 should run the nginx Pod"
Kubelet(node-3) → containerd → start nginx container
Kubelet(node-3) → API Server → "nginx Pod Running"
```

If a container in a Pod dies, kubelet restarts it according to `restartPolicy`. But kubelet does not schedule. It never moves a Pod to another node; that is the [scheduler](chunk://scheduler)'s job.

## Kube-proxy

The network proxy on every node. It forwards Service → Pod traffic.

Pod IPs change (a recreated Pod gets a new one; a container restart does not), but the Service IP (ClusterIP) does not. Kube-proxy maintains iptables or IPVS rules that forward traffic sent to the Service IP on to the Pods behind it.

```text
Client → Service IP (10.96.0.1) → kube-proxy rules → Pod IP (10.244.1.5)
```

Three modes:

| Mode | Mechanism | When |
|---|---|---|
| iptables | One NAT rule per Service | Default, enough for a few thousand Services |
| IPVS | Load balancing inside the kernel | Many Services (>1000), or more LB algorithms needed |
| userspace | kube-proxy forwards the traffic itself | Removed since Kubernetes 1.26 |

## What happens when the control plane goes down

Pods already running are not affected. Kubelet keeps the containers running, and the kube-proxy rules stay in place. But no new Pod can be scheduled, a dead Pod is not rescheduled, and Service endpoints are not updated.
