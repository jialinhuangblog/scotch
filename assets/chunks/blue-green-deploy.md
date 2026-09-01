---
title: "Blue-Green Deployment"
slug: blue-green-deploy
brief: "兩套完整環境，流量切換像開關一樣，rollback 就是切回原來那邊。"
date: 2026-04-02
article: progressive-delivery
---

# Blue-Green Deployment

同時跑兩套完整的環境。Blue 是目前的 production，Green 是新版。

## 流程

```
Blue (v1) ← 100% 流量
Green (v2) ← 0% 流量，部署中

部署完成，smoke test 通過：
Blue (v1) ← 0%
Green (v2) ← 100% 流量    ← 切換

出事了：
Blue (v1) ← 100% 流量     ← rollback
Green (v2) ← 0%
```

切換是瞬間的。不是逐步換 Pod，是整個環境一次切。rollback 也是瞬間的，舊環境還在。

## 代價

資源成本翻倍。部署期間兩套環境都在跑。如果 prod 跑 20 個 Pod，blue-green 部署期間就是 40 個。

最麻煩的是資料庫 migration。Blue 和 Green 共用同一個 DB，schema change 必須向前相容。不然切回 Blue 的時候，Blue 讀不懂 Green 改過的 schema。

## 跟 Canary 的差異

canary 是慢慢放流量，風險分散在一段時間；blue-green 是一次全換，風險集中在切換的那一下。Canary 適合想用 metrics 慢慢驗證的場景。Blue-green 適合需要瞬間回滾能力的場景。
