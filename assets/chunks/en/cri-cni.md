---
title: "CRI & CNI"
slug: cri-cni
brief: "k8s only defines the runtime and network interfaces; containerd, CRI-O, Calico, Cilium plug in behind them."
article: four-interfaces-one-pod
date: 2026-04-08
updated: 2026-10-17
revisions: 1
---

# CRI & CNI

k8s only defines the interfaces for the container runtime and the network. Other projects supply the implementations.

## CRI (Container Runtime Interface)

When the kubelet needs to start a container, it does not call Docker or containerd directly. It calls the runtime through CRI, a gRPC interface.

```text
Kubelet → CRI → containerd → start container
Kubelet → CRI → CRI-O → start container
```

Why the extra layer? Early k8s was tied to Docker, and the Docker daemon bundled build, push, network, volume and much more, while k8s only needed "run a container". CRI pulled the interface out, so any runtime that implements CRI can be used. (The full history of container runtimes is in [K8s needed Docker. Then it didn't.](https://jialin00.com/v2/container-runtime-evolution).)

| Runtime | Notes |
|---|---|
| containerd | The core split out of Docker. The most widely used today |
| CRI-O | Led by Red Hat, built for k8s, lighter |
| gVisor (runsc) | Google's sandbox runtime, one more layer of isolation |
| Kata Containers | Each Pod runs in its own lightweight VM, hard isolation |

Docker itself also supports CRI (through the cri-dockerd shim), but since k8s 1.24 dockershim is no longer built in.

## CNI (Container Network Interface)

Every Pod needs its own IP. CNI is responsible for creating the network namespace, assigning the IP, and setting up routes.

```text
Pod created → kubelet calls CNI plugin → assign IP + set up veth pair → Pod has network
```

The k8s network model requires:

1. Every Pod has its own IP
2. All Pods can talk to each other (without NAT)
3. Agents on a node can talk to the Pods on that node

Different CNI plugins get there in different ways:

| Plugin | Mechanism | Fit |
|---|---|---|
| Calico | BGP routing or VXLAN overlay | Most common, supports NetworkPolicy |
| Cilium | eBPF handles packets in the kernel | High performance, strong observability |
| Flannel | VXLAN overlay | Simplest, fewest features |
| AWS VPC CNI | Assigns VPC IPs directly from AWS ENIs | EKS only, the Pod IP is a VPC IP |

## Why a plugin architecture

Same problem, different best answer in each environment. The cloud uses the cloud's CNI (VPC CNI), bare metal uses Calico, and security sensitive setups use Kata + Cilium.
