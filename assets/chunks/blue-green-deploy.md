---
title: "Blue-Green Deployment"
slug: blue-green-deploy
brief: "兩套完整環境，流量一次全部切到新版，rollback 就是切回原來那套。"
date: 2026-04-02
updated: 2026-10-18
revisions: 2
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

最麻煩的是資料庫 migration，因為 Blue 和 Green 共用同一個 DB。v2 想把 users 表的 `name` 欄位拆成 `first_name` 跟 `last_name`。要是 migration 直接把 `name` 刪掉，Green 切上去十分鐘後發現 bug 要切回 Blue，v1 的 code 還在 `SELECT name`，欄位已經不在了，rollback 等於另一次故障。所以 schema change 要分兩步。第一步的 migration 只加 `first_name`、`last_name`，把現有每一列的 `name` 拆開填進去（backfill），`name` 留著。v2 寫入時三個欄位都寫；讀取時先讀 `first_name`，是 null 就改讀 `name` 自己拆。會有 null，是因為切換之前 Blue 還在接流量，v1 新寫進來的 user 只有 `name`，切回 Blue 再切回來又會多一批。第二步等確定不會再切回 v1，再跑一次 backfill 把這些 row 補齊，下一個版本才刪 `name`。

## 跟 Canary 的差異

canary 慢慢放流量，風險分散在一段時間裡，適合想用 metrics 慢慢驗證的場景。blue-green 一次全換，風險集中在切換那一下，好處是回滾同樣只要切一次。
