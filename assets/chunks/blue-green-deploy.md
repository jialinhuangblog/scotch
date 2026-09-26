---
title: "Blue-Green Deployment"
slug: blue-green-deploy
brief: "兩套完整環境，流量一次全部切到新版，rollback 就是切回原來那套。"
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

切換是整個環境一次切過去，不是逐步換 Pod，所以是瞬間完成的。舊環境還在，rollback 也一樣快。

## 代價

資源成本翻倍，因為部署期間兩套環境都在跑。如果 prod 跑 20 個 Pod，blue-green 部署期間就是 40 個。

最麻煩的是資料庫 migration。Blue 和 Green 共用同一個 DB，所以 schema change 必須讓舊版的 code 也能用。不然切回 Blue 的時候，Blue 會讀不懂 Green 改過的 schema。

## 跟 Canary 的差異

canary 慢慢放流量，風險分散在一段時間裡，適合想用 metrics 慢慢驗證的場景。blue-green 一次全換，風險集中在切換那一下，好處是回滾同樣只要切一次。
