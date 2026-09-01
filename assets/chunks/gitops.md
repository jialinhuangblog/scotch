---
title: "GitOps"
slug: gitops
brief: "Git 是唯一真相來源。Cluster 內的 agent 拉取並收斂。不用 push 部署。"
date: 2026-03-14
article: gitops-deep
---

# GitOps

一切以 Git 為準，cluster 的狀態、pipeline 的動作，全都跟著 Git 走。

## Push vs Pull

傳統 CI/CD：pipeline build 完 image，主動推到 cluster（`helm upgrade`、`kubectl apply`）。Pipeline 需要 cluster credential。

GitOps：agent 跑在 cluster 裡，watch Git repo。Git 有新 commit → agent 偵測 diff → 自動 sync。是 cluster 主動把變更拉下來，pipeline 從頭到尾不會碰到 cluster。

## 為什麼 Pull 更好

1. **安全**：CI pipeline 不需要 cluster credential，attack surface 小。
2. **Drift detection**：agent 一直在比對「cluster 現在長怎樣」跟「Git 說該長怎樣」。要是有人繞過 Git、直接用 kubectl 去操作 cluster，cluster 就跟 Git 對不上，agent 馬上看得出這個落差（這就是 drift），可以警告你、或直接改回 Git 上的版本。
3. **跟 k8s 哲學一致**：k8s 本身就是 reconciliation loop，GitOps 只是把 desired state 的來源從 etcd 延伸到 Git。

## 工具

ArgoCD 和 Flux 是兩大 GitOps controller。都跑在 cluster 裡，都 watch Git，都做 reconciliation。ArgoCD 有 UI dashboard，Flux 純 CLI。
