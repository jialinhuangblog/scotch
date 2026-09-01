---
title: "Affinity"
slug: node-affinity
brief: "pod 主動表達偏好：required 走 filter，preferred 走 score；anti-affinity 把同服務的 pod 散開。"
date: 2026-07-20
updated: 2026-07-20
revisions: 1
---

# Affinity

[Scheduler](chunk://scheduler) 排 Pod 時，Pod 主動表達偏好的機制：「我想去哪」或「我不想跟誰在一起」。

**nodeAffinity** — Pod 對 node 的偏好，比 nodeSelector 更彈性：

```yaml
spec:
  affinity:
    nodeAffinity:
      # hard：必須滿足（等同 filter）
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: zone
                operator: In
                values: ["us-east-1a", "us-east-1b"]
      # soft：盡量滿足（影響 score）
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 80
          preference:
            matchExpressions:
              - key: disk
                operator: In
                values: ["ssd"]
```

`required` 是 filter 層，不符合直接淘汰。`preferred` 是 score 層，符合加分但不強制。

**podAntiAffinity** — 同一個 service 的 Pod 散到不同 zone：

```yaml
spec:
  affinity:
    podAntiAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        - labelSelector:
            matchLabels:
              app: api
          topologyKey: topology.kubernetes.io/zone
```

拆開看這條規則怎麼得出「zone-a 有了就不能再放」：

- `labelSelector` 圈出「誰」：帶 `app: api` 的 Pod。
- `topologyKey` 決定「多大範圍算同一格」：每台 node 身上都有 `topology.kubernetes.io/zone` 這個 label（cloud provider 自動打），值一樣的 node 屬於同一個 zone。
- anti-affinity 的 required 規則：不要把我排進「已經有被圈中 Pod」的那一格。

Scheduler 檢查每台候選 node 時，先看它的 zone label 值，再看整個 zone 裡有沒有任何 node 跑著 `app: api` 的 Pod。有，這台 node 就被 filter 掉。所以 zone-a 只要有一個 `app: api`，zone-a 的**每一台** node 都過不了 filter，下一個 Pod 只能去 zone-b、zone-c。

把 `topologyKey` 換成 `kubernetes.io/hostname`，「一格」就從 zone 縮成單一 node，規則變成「同 node 不要放兩個」。
