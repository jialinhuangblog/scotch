---
title: "Kustomize"
slug: kustomize
brief: "Overlay 式 k8s 設定。Patch 真正的 YAML，沒有 template 語法。"
date: 2026-03-14
article: helm-deep
---

# Kustomize

Kustomize 的做法是 patch 既有的 YAML，整套沒有 template。

## Base + Overlay

Base 資料夾放真正的 YAML — 不是模板，是能直接 `kubectl apply` 的完整 YAML。

Overlay 資料夾只寫差異。Production overlay 把 replica 從 1 改成 5，image tag 改成 stable。

```
base/
  deployment.yaml    ← 真實 YAML，replica: 1
  service.yaml
overlays/
  prod/
    kustomization.yaml
    patch-replicas.yaml  ← 只寫 replica: 5
```

`kubectl apply -k overlays/prod/` — Kustomize 把 base + patch 合併，產出最終 YAML。

## vs Helm

Helm 的模板是 `{{ .Values.x }}`。Kustomize 的 base 是真正的 YAML，任何人都讀得懂。

Helm 適合第三方 chart（Redis、Nginx Ingress）— 參數化彈性大。Kustomize 適合自家 app — 差異小，可讀性優先。
