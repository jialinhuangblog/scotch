---
title: "Scheduler"
slug: scheduler
brief: "決定 pod 跑在哪個 node。先用 filter 淘汰不合格的 node，再用 score 從剩下的挑一個最好的。"
date: 2026-04-08
updated: 2026-07-20
revisions: 2
---

# Scheduler

Pod 建立了，但還沒有 node。Scheduler 從所有 node 中挑一個最適合的。

## Filter：淘汰不合格的 node

Filter 問的是「這個 node 能不能跑」。任何一項不通過，直接淘汰。

假設一個 Pod 要求 2 CPU、4Gi 記憶體，並且指定只跑在有 `disk=ssd` label 的 node：

```yaml
spec:
  containers:
    - name: api
      resources:
        requests:
          cpu: "2"
          memory: "4Gi"
  nodeSelector:
    disk: ssd
```

```text
node-1: 剩餘 1 CPU     → 資源不夠，淘汰
node-2: 沒有 disk=ssd  → label 不匹配，淘汰
node-3: 4 CPU + disk=ssd → 通過
node-4: 8 CPU + disk=ssd → 通過
```

其他 filter 條件：[taint 沒有對應 toleration](chunk://taint-toleration)、[affinity 規則不符合](chunk://node-affinity)，這兩個機制各自拆成獨立 chunk。

## Score：從通過的 node 中挑最佳

Filter 後可能剩多個 node。Score 用多個擴充分別打分，加總選最高。

兩個主要擴充：

| 擴充 | 評什麼 | 邏輯 |
|---|---|---|
| LeastAllocated | CPU/記憶體餘量 | `((capacity - requested) / capacity) * 100`，剩越多分越高 |
| ImageLocality | image 是否已拉過 | image 已在 node 上 → 省下載時間，加分 |

Scheduler 不看實際 CPU 用量，只看所有已排 Pod 的 `resources.requests` 加總。

假設兩台 node 各有 8 CPU、16Gi 記憶體，公式是 `((capacity - requested) / capacity) × 100`，CPU 和 memory 各算一次再取平均：

1. **node-3** 已經被 request 掉 6 CPU、12Gi。CPU 餘量 `(8-6)/8 × 100 = 25`，memory `(16-12)/16 × 100 = 25`，平均 LeastAllocated = 25。
2. **node-4** 只被 request 掉 2 CPU、4Gi。CPU `(8-2)/8 × 100 = 75`，memory `(16-4)/16 × 100 = 75`，平均 = 75。剩越多分越高，目前 node-4 領先。
3. 再加 ImageLocality：node-3 還沒拉過這個 image，加 0 分，維持 25；node-4 上已經有，加 15 分，變成 90。
4. 兩邊一比，pod 排到 node-4。

## Binding：scheduler 只填 nodeName，不負責啟動 Pod

Pod 物件在 `kubectl apply` 時就已經存進 etcd，但 `nodeName` 是空的。Scheduler 選完後，更新這個欄位：

```yaml
# 排程前（Pod 已在 etcd，nodeName 空）
spec:
  nodeName: ""

# 排程後（Scheduler 更新 nodeName）
spec:
  nodeName: "node-4"
```

該 node 上的 [kubelet](chunk://data-plane) watch 到 `nodeName` 變成自己，才真正拉 image、啟動 container。Scheduler 只寫下決定，真正的啟動動作不歸它管。

