---
title: "GitOps"
slug: gitops
brief: "cluster 的狀態以 Git 為準。cluster 內的 agent 從 Git 拉取變更並套用，pipeline 不用 push 部署。"
date: 2026-03-14
article: gitops-deep
---

# GitOps

cluster 該是什麼狀態，以 Git 裡的 manifest 為準。要改 cluster，就改 Git。

## Push vs Pull

傳統 CI/CD：pipeline build 完 image，主動推到 cluster（`helm upgrade`、`kubectl apply`）。Pipeline 需要 cluster credential。

GitOps：agent 跑在 cluster 裡，watch Git repo。Git 有新 commit → agent 偵測 diff → 自動 sync。是 cluster 主動把變更拉下來，pipeline 從頭到尾不會碰到 cluster。

## 為什麼 Pull 更好

1. **安全**：CI pipeline 不需要 cluster credential，attack surface 小。
2. **Drift detection**：agent 一直在比對「cluster 現在長怎樣」跟「Git 說該長怎樣」。要是有人繞過 Git、直接用 kubectl 去操作 cluster，cluster 就跟 Git 對不上，agent 馬上看得出這個落差（這就是 drift），可以發出警告，或直接改回 Git 上的版本。
3. **跟 k8s 哲學一致**：k8s 本身就是 reconciliation loop，GitOps 只是把 desired state 的來源從 etcd 延伸到 Git。

## 工具

ArgoCD 跟 Flux 是最常見的兩個 GitOps controller，兩個都跑在 cluster 裡 watch Git 並做 reconciliation。ArgoCD 內建 UI dashboard。Flux 本身沒有內建 UI，主要用 CLI 操作，要圖形介面得另外裝 Capacitor 這類工具。
