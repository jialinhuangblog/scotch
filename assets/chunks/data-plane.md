---
title: "Data Plane"
slug: data-plane
brief: "Kubelet 和 kube-proxy。Pod 實際跑的地方。"
date: 2026-04-08
---

# Data Plane

Control plane 決定 Pod 要跑在哪個 node，data plane 在 node 上實際把 Pod 跑起來。每個 worker node 上都跑著 kubelet 和 kube-proxy。

## Kubelet

每個 node 上的 agent。

1. **Watch API server**：看有沒有被分配到這個 node 的 Pod
2. **啟動 Pod**：透過 [CRI](chunk://cri-cni) 呼叫 container runtime（containerd、CRI-O）
3. **回報狀態**：定期送 heartbeat 和 Pod status 回 API server

Kubelet 不管 container 裡跑什麼。它只確保 container 的生命週期符合 spec。

```text
API Server → "node-3 要跑 nginx Pod"
Kubelet(node-3) → containerd → 啟動 nginx container
Kubelet(node-3) → API Server → "nginx Pod Running"
```

Pod 裡的 container 掛了，kubelet 會根據 `restartPolicy` 重啟。但 kubelet 不做調度，不會把 Pod 搬到別的 node，那是 [scheduler](chunk://scheduler) 負責的。

## Kube-proxy

每個 node 上的網路代理。負責 Service → Pod 的流量轉發。

Pod IP 會變（重啟就換），但 Service IP（ClusterIP）不會。Kube-proxy 維護 iptables 或 IPVS 規則，把送到 Service IP 的流量轉到背後的 Pod。

```text
Client → Service IP (10.96.0.1) → kube-proxy 規則 → Pod IP (10.244.1.5)
```

三種模式：

| 模式 | 機制 | 適用 |
|---|---|---|
| iptables | 每個 Service 一條 NAT 規則 | 預設，夠用到幾千個 Service |
| IPVS | 核心層負載均衡 | Service 數量大（>1000），需要更多 LB 演算法 |
| userspace | kube-proxy 自己轉發 | Kubernetes 1.26 起已移除 |

## Control Plane 掛了會怎樣

已經跑著的 Pod 不受影響。Kubelet 繼續維持 container 運行，kube-proxy 規則還在。但新 Pod 無法排程、舊 Pod 掛了不會被重新調度、Service endpoint 不會更新。
