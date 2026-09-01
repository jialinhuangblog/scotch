---
title: "Control Plane"
slug: control-plane
brief: "API server、scheduler、controller-manager。k8s 的大腦。"
date: 2026-03-09
---

# Control Plane

與其說有個大腦，不如說每個元件都盯著 etcd，看到變化就自己反應。

## 三個核心元件

**1. API Server**
唯一能寫 etcd 的入口。所有請求都經過這裡：驗證、授權、寫入 etcd。

**2. Scheduler**
盯著「沒有 node 的 Pod」，算分、選 node、更新 etcd。沒有直接啟動 Pod，只是寫決定。

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
- **聲明式**：你說要什麼，不說怎麼做
- **解耦**：每個元件透過 etcd 間接溝通，不直接呼叫
- **弱點**：etcd 掛了，整個 control plane 停擺
