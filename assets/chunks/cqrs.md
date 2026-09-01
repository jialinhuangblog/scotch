---
title: "CQRS"
slug: cqrs
brief: "讀和寫用不同的 model。大部分系統不需要，但對的場景下，沒什麼更好的替代方案。"
article: scaling-first-move
date: 2026-04-07
---

# CQRS

Command Query Responsibility Segregation。讀模型和寫模型分離。

## 為什麼要分

一般系統用同一張表讀寫。寫入用正規化的 schema（避免重複），讀取也從這個 schema 拿（可能需要 JOIN）。

問題出在兩端的需求不同。寫入要的是一致性和正確性。讀取要的是速度和方便的結構。一張表很難同時滿足。

CQRS 的做法：寫入走 command model（正規化的表），讀取走 query model（反正規化的、預先計算好的 view）。

```text
寫入 → Command Model（orders + order_items + products）
讀取 → Query Model（monthly_sales_summary）
```

Query model 由 command model 的變更事件驅動更新。通常透過 message queue 非同步同步。

## 代價

- 雙倍 schema 維護
- Read model 有延遲（非同步更新，eventual consistency）
- 除錯更複雜（資料在兩個地方）

## 什麼時候值得

- Read 和 write 的 schema 差異大（JOIN 太重）
- Read/write 的 scale 需求差異極大
- 已有 event-driven 架構，CQRS 只是掛上去

大部分 CRUD 系統不需要。一張表 + 幾個 index 就夠了。
