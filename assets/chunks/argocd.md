---
title: "ArgoCD"
slug: argocd
brief: "k8s 原生 GitOps 控制器。監聽 Git repo，跟 cluster 比對差異，自動同步。"
date: 2026-03-14
updated: 2026-07-20
revisions: 2
article: gitops-deep
---

# ArgoCD

一個跑在 k8s 裡的 controller，盯著 Git repo，確保 cluster 跟 Git 一致。

## Application CRD

ArgoCD 用一個叫 Application 的 Custom Resource 描述要部署什麼：

```yaml
source:
  repoURL: https://github.com/my-org/k8s-manifests
  path: apps/my-service
  targetRevision: main
destination:
  server: https://kubernetes.default.svc
  namespace: production
```

指定 Git repo + path + 目標 cluster。ArgoCD 定期拉 Git，跟 cluster 實際狀態比較。

## Sync

- **OutOfSync** — Git 和 cluster 不一致。UI 亮黃燈。
- **Synced** — 一致。綠燈。
- **Auto-sync** — 偵測到 diff 就自動 apply。不開的話是 manual sync，等人按按鈕。

## Drift 偵測

有人用 `kubectl edit` 手動改了 replica，ArgoCD 下次 diff 就會發現。因為 ArgoCD 以 Git 為準，cluster 上的手動改動會被當成 drift。

傳統 pipeline push 完就不管了，ArgoCD 則持續監控。
