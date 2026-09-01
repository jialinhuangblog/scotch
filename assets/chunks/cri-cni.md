---
title: "CRI & CNI"
slug: cri-cni
brief: "Container 和網路介面。任何實作都能插入。"
article: four-interfaces-one-pod
date: 2026-04-08
---

# CRI & CNI

k8s 不自己做 container runtime，也不自己做網路。它定義介面，讓別人實作。

## CRI（Container Runtime Interface）

Kubelet 要啟動 container，不直接呼叫 Docker 或 containerd。它透過 CRI 這個 gRPC 介面。

```text
Kubelet → CRI → containerd → 啟動 container
Kubelet → CRI → CRI-O → 啟動 container
```

為什麼要多一層？因為 k8s 早期綁死 Docker。Docker 太肥（Docker daemon 包了 build、push、network、volume），k8s 只需要「跑 container」這一件事。CRI 把介面抽出來，任何 runtime 只要實作 CRI 就能用。（完整的 container runtime 演進史可以看[這篇](https://jialin00.com/v2/container-runtime-evolution)。）

| Runtime | 特色 |
|---|---|
| containerd | Docker 拆出來的核心。目前最主流 |
| CRI-O | Red Hat 主導，專為 k8s 設計，更輕量 |
| gVisor (runsc) | Google 的沙箱 runtime，多一層隔離 |
| Kata Containers | 每個 container 跑在輕量 VM 裡，硬隔離 |

Docker 自己也支援 CRI（透過 cri-dockerd shim），但 k8s 1.24 起不再內建 dockershim。

## CNI（Container Network Interface）

每個 Pod 需要自己的 IP。CNI 負責：建 network namespace、分配 IP、設定路由。

```text
Pod 建立 → kubelet 呼叫 CNI plugin → 分配 IP + 設定 veth pair → Pod 有網路了
```

CNI 的規則很簡單：

1. 每個 Pod 有獨立 IP
2. 所有 Pod 可以互相通訊（不需要 NAT）
3. Node 上的 agent 可以跟該 node 的 Pod 通訊

不同 CNI plugin 用不同方式達成：

| Plugin | 機制 | 適用 |
|---|---|---|
| Calico | BGP 路由 或 VXLAN overlay | 最常用，支援 NetworkPolicy |
| Cilium | eBPF 在核心層處理封包 | 高效能，可觀測性強 |
| Flannel | VXLAN overlay | 最簡單，功能少 |
| AWS VPC CNI | 直接用 AWS ENI 分配 VPC IP | EKS 專用，Pod IP 就是 VPC IP |

## 為什麼是 plugin 架構

同一個問題，不同環境有不同最佳解。雲端用雲端的 CNI（VPC CNI），bare metal 用 Calico，安全敏感場景用 Kata + Cilium。k8s 不選邊，只定義契約。
