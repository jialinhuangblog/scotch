---
title: "Taint & Toleration"
slug: taint-toleration
brief: "node 主動標記不歡迎，沒帶 toleration 的 pod 在 filter 階段直接淘汰。"
date: 2026-07-20
updated: 2026-07-20
revisions: 1
---

# Taint + Toleration

[Scheduler](chunk://scheduler) filter 階段的其中一關，方向跟 nodeSelector 相反：不是 Pod 挑 node，是 node 主動標記「不歡迎」。沒有容忍的 Pod，filter 階段直接淘汰。

場景：一台 GPU node，不想讓普通 workload 佔資源。

```yaml
# node 上設 taint（管理員操作）
# kubectl taint nodes gpu-node-1 gpu=true:NoSchedule

# Pod 要跑在 GPU node，必須加 toleration
spec:
  tolerations:
    - key: "gpu"
      operator: "Equal"
      value: "true"
      effect: "NoSchedule"
```

沒加 toleration 的 Pod → filter 淘汰。加了的 → 允許排上去。

比對條件是兩段，effect 也算一段：

- **key / value**：`operator: Equal` 要 key 和 value 都相等；`operator: Exists` 只看 key 存不存在，不看 value。
- **effect**：taint 的 effect 講的是「對不容忍的 Pod 做什麼」。`NoSchedule` 不排進來、`PreferNoSchedule` 盡量不排（軟性）、`NoExecute` 最兇，連已經在上面跑的 Pod 都會被撤走。toleration 寫了 effect 就只容忍那一種；整個省略 effect 欄位，等於容忍這個 key 的全部 effect。

所以上面的例子讀作：「我容忍 `gpu=true` 這個 taint 的 `NoSchedule`」。如果 node 之後被加了 `gpu=true:NoExecute`，這個 Pod 一樣會被撤走，因為它只容忍了 NoSchedule。

注意 toleration 只是「允許」，不是「指定」：加了 toleration 的 Pod 也可能被排到別台 node。要真的黏在 GPU node 上，得再配 [affinity](chunk://node-affinity)。
