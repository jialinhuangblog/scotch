---
title: "Control Plane"
slug: control-plane
brief: "API server、scheduler、controller-manager。k8s 的決策都在這一層發生。"
date: 2026-03-09
---

# Control Plane

control plane 裡沒有一個總指揮。每個元件都透過 API server 監看 [etcd](chunk://etcd)（存所有 cluster 狀態的 key-value store）裡的狀態，看到變化就自己處理。

## 核心元件

**1. API Server**
唯一能讀寫 etcd 的入口。所有請求都經過這裡，依序做驗證、授權，再寫入 etcd。

**2. Scheduler**
監看還沒分配 node 的 Pod，算分、選 node，再透過 API server 把結果寫回。它不啟動 Pod，只寫下決定。

**3. Controller Manager**
一群 controller 的集合。每個 controller 跑一個 reconciliation loop：
```
觀察 desired state → 比較 actual state → 執行動作 → 重複
```

## 為什麼叫 Control Plane？

- **Control**：決策在這裡發生（調度、副本數、health check）
- **Plane**：一個邏輯層，跟 data plane 分離
- **Data plane**：node 上的 kubelet + kube-proxy，實際執行 Pod

## 設計特色

- **無狀態**：所有狀態在 etcd，control plane 掛了可以立刻換
- **聲明式**：只描述要什麼狀態，不描述怎麼做
- **解耦**：元件之間不直接呼叫，都透過 API server 讀寫同一份狀態
- **弱點**：etcd 掛了，整個 control plane 停擺
