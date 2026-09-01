---
title: "Argo Rollouts"
slug: argo-rollouts
brief: "k8s 原生 progressive delivery controller。取代 Deployment，加上 canary 和 blue-green 策略。"
date: 2026-04-02
article: progressive-delivery
---

# Argo Rollouts

k8s 原生的 Deployment 只會 rolling update。Argo Rollouts 是一個 CRD + controller，取代 Deployment，支援 canary 和 blue-green。

## Rollout CRD

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: my-app
spec:
  strategy:
    canary:
      steps:
        - setWeight: 5
        - pause: { duration: 5m }
        - setWeight: 20
        - pause: { duration: 5m }
        - setWeight: 50
        - pause: { duration: 5m }
        - setWeight: 100
```

`setWeight: 5` 把 5% 流量導到新版。`pause` 等 5 分鐘觀察。一路遞增到 100%。

## AnalysisRun

手動看 dashboard 太慢。AnalysisRun 自動查 Prometheus metrics：

```yaml
- setWeight: 20
- analysis:
    templates:
      - templateName: error-rate-check
    args:
      - name: service-name
        value: my-app
```

AnalysisTemplate 定義查詢：「過去 5 分鐘 error rate < 1%？」。通過就繼續，失敗就自動 rollback。

## 跟 ArgoCD 的關係

ArgoCD 負責 sync Git 到 cluster。Argo Rollouts 負責 sync 之後的流量控制。ArgoCD 把 Rollout CRD apply 到 cluster，Rollouts controller 接手執行 canary/blue-green 策略。
