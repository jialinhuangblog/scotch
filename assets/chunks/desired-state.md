---
title: "Desired State"
slug: desired-state
brief: "宣告要什麼，讓 controller 收斂。k8s、Terraform、ArgoCD 都用這個模式。"
date: 2026-03-14
updated: 2026-10-18
revisions: 2
article: before-k8s
---

# Desired State

只描述想要的結果，怎麼達成由系統自己決定。

## 命令式 vs 宣告式（imperative vs declarative）

命令式：「在 node A 建一個 container，設 port 8080，連到 load balancer。」描述的是步驟，步驟出錯就修步驟。

宣告式：「我要 3 個 replica，port 8080，有 load balancer。」描述的是結果，系統自己算怎麼達到。

k8s 是宣告式的。Deployment YAML 寫 `replicas: 3`，controller 每隔一下就數一次現在有幾個 Pod。三個都在，什麼都不做。半夜一台 node 壞掉，上面那個 Pod 不會馬上消失：node 被判定失聯之後，k8s 預設讓 Pod 在那台 node 上再留五分鐘（`tolerationSeconds=300`）。五分鐘一到，Pod 被驅逐，controller 數到 2，跟 3 差 1，就再建一個，排到別台 node 上。沒有人寫過「node 壞掉時要重建 Pod」這條指令，controller 只是在補差額。這個「數、比、補」的循環叫 reconciliation loop。

有人手動 `kubectl scale` 到 5，改的是 desired state 本身，Deployment 要的變成 5 個。controller 拿現有的 3 個跟 5 比，再建兩個，不會把它改回 3。要把 5 改回 3，得有另一份 desired state 擺在 cluster 外面，例如 [GitOps](chunk://gitops) 裡 Git 寫的 `replicas: 3`，由 ArgoCD 這類工具拿 cluster 跟 Git 比。

## k8s、Terraform、ArgoCD 用的都是宣告式

- **k8s**：Deployment YAML = desired state，controller reconcile
- **Terraform**：`.tf` 檔 = desired state，`terraform apply` 算 diff 並執行
- **ArgoCD**：Git repo = desired state，agent sync 到 cluster

同一份 desired state，apply 一次跟 apply 十次結果都一樣。`replicas: 3` 再 apply 一遍，controller 數到 3，差 0，一個 Pod 都不動。這個性質叫 [冪等](chunk://idempotency)（idempotent）。所以狀態壞掉時不用一步步 debug 該怎麼修，把 desired state 重新 apply 一遍，系統自己收斂回去就好。
