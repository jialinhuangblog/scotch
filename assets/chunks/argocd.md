---
title: "ArgoCD"
slug: argocd
brief: "k8s 原生 GitOps 控制器。監聽 Git repo，跟 cluster 比對差異，自動同步。"
date: 2026-03-14
updated: 2026-10-18
revisions: 4
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

CI 把 manifest repo 裡 `apps/my-service/deployment.yaml` 的 image tag 從 `api:a81d0b7` 改成 `api:3f9c2e1`，commit 進 main。ArgoCD 預設每 3 分鐘拉一次 repo，拉到新 commit，算出 Git 要的是 `3f9c2e1`、cluster 跑的是 `a81d0b7`，這個 Application 就變成 OutOfSync。

- **OutOfSync** — Git 和 cluster 不一致。UI 亮黃燈。
- **Synced** — 一致。綠燈。
- **Auto-sync** — 偵測到 diff 就自動 apply。開著的話，ArgoCD 自己 apply 新的 Deployment，cluster 上的 spec 跟 Git 一樣了，就回到 Synced 綠燈。不開的話是 manual sync，黃燈一直亮到有人按按鈕。

Synced 只比 manifest，rolling update 有沒有跑完是另一個狀態，叫 health。apply 完、新 Pod 還在起來，畫面是 Synced 加上 Progressing；Deployment 的 Pod 全部換成新版，health 才變 Healthy。新 Pod 要是一直 CrashLoopBackOff，畫面會停在 Synced 加 Progressing，等 Deployment 超過 progress deadline 才變 Degraded。所以看到 Synced，代表 Git 裡的 manifest 已經送上 cluster，新版有沒有在接流量要看 health。

## Drift 偵測

有人用 `kubectl edit` 把 replica 從 3 改成 5。Git 裡還是 3，ArgoCD 下次 diff 就會發現，Application 又變 OutOfSync。auto-sync 加上 selfHeal 的話，會直接把 cluster 改回 3。因為 ArgoCD 以 Git 為準，cluster 上的手動改動會被當成 drift。

傳統 pipeline push 完就不管了，ArgoCD 則持續監控。
