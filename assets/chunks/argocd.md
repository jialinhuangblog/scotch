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

ArgoCD 的核心概念是 Application — 一個 Custom Resource：

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
- **Auto-sync** — 偵測到 diff 自動 apply。或 manual sync，等人按按鈕。

## Drift 偵測

有人 `kubectl edit` 手動改了 replica？ArgoCD 下次 diff 就會發現。它知道 Git 才是 truth，cluster 的手動改動是 drift。

這是它跟傳統 CI/CD 最大的差異：傳統 pipeline push 完就不管了。ArgoCD 持續監控。
