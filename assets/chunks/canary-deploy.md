---
title: "Canary Deployment"
slug: canary-deploy
brief: "先放 5% 流量到新版，metrics 正常再逐步放到全部。出事也只影響 5% 的 user。"
date: 2026-04-02
article: progressive-delivery
---

# Canary Deployment

Rolling update 的問題：readiness probe 一過，就把所有 replica 全換成新版。如果 app 有 logic bug、error rate 升高，rolling update 不會察覺，要等全部 replica 都換完才發現出事。

Canary 把「部署」和「放量」拆開。

## 流程

```
部署新版 Pod（但不給流量）
  → 切 5% 流量到新版
  → 觀察 error rate、latency、5xx
  → 數字正常 → 20% → 50% → 100%
  → 數字異常 → 自動切回舊版
```

流量切分靠 Service Mesh（Istio）或 Ingress controller 的 weighted routing。k8s 原生的 Service 做不到百分比分流，它只會 round-robin 到所有 Pod。

## 跟 Rolling Update 的差異

| | Rolling Update | Canary |
|---|---|---|
| 流量控制 | 沒有，新 Pod ready 就收流量 | 百分比遞增 |
| 回滾觸發 | 手動，或 probe 失敗 | metrics gate 自動判斷 |
| 波及範圍 | 漸進但無 metrics gate | 最多 5%（看設定） |
| 需要額外工具 | 不需要 | 需要 Argo Rollouts 或 Flagger |
