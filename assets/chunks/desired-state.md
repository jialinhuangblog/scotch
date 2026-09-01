---
title: "Desired State"
slug: desired-state
brief: "宣告你要什麼，讓 controller 收斂。k8s、Terraform、ArgoCD 都用這個模式。"
date: 2026-03-14
article: before-k8s
---

# Desired State

你只描述想要的結果，系統自己去想怎麼達成。

## 命令式 vs 宣告式（imperative vs declarative）

命令式：「在 node A 建一個 container，設 port 8080，連到 load balancer。」你描述步驟。步驟出錯，你修步驟。

宣告式：「我要 3 個 replica，port 8080，有 load balancer。」你描述結果。系統自己算怎麼到達。

k8s 是宣告式的。你寫 YAML 描述 desired state，controller 不斷比較 actual state，有差距就行動。這個循環叫 reconciliation loop。

## k8s、Terraform、ArgoCD 都是同一套

- **k8s**：Deployment YAML = desired state，controller reconcile
- **Terraform**：`.tf` 檔 = desired state，`terraform apply` 算 diff 並執行
- **ArgoCD**：Git repo = desired state，agent sync 到 cluster

宣告式還有一個好處：同一份 desired state，apply 一次跟 apply 十次，結果都一樣。這個性質叫 [冪等](chunk://idempotency)（idempotent）。所以狀態壞掉時不用一步步 debug 該怎麼修，把 desired state 重新 apply 一遍，系統自己收斂回去就好。
