---
title: "Bounded Context"
slug: bounded-context
brief: "同一個 term 在不同 subdomain 意義不同。各自 model，邊界處明確翻譯。"
article: ddd-textbook-vs-real
date: 2026-06-14
---

# Bounded Context

DDD 的 strategic 層概念。一個 term 在不同地方，定義、認知或是聯想到的情境會有所不同。

## 經典範例

「Customer」這個詞：

| subdomain | Customer 的 model |
|---|---|
| Sales | 潛在買家、有 lead score、有 sales rep 負責 |
| Support | 已購買的人、有 ticket history、有訂閱方案 |
| Billing | 有付款記錄、有 invoice、有 tax 設定 |

如果硬讓三個 subdomain 共用一個 `Customer` class，會變得很難維護，三邊的欄位全擠進同一個 class，改一個地方就影響到另外兩個 subdomain，業務規則也分不開。

## DDD 的解法

三個 subdomain 各自有一個 Customer，名字一樣但內容完全不同，放在不同 module：

```typescript
// sales/customer.ts（銷售眼中的客戶）
class Customer { id; leadScore: number; salesRep: string; stage: 'lead' | 'qualified' | 'won' }

// support/customer.ts（客服眼中的客戶）
class Customer { id; tickets: Ticket[]; plan: 'free' | 'pro' }

// billing/customer.ts（帳務眼中的客戶）
class Customer { id; invoices: Invoice[]; taxId: string }
```

三個在資料庫可能都對到同一個 user_id，但在 code 裡是三個互不相干的 class。要跨 context 溝通就走明確翻譯（Anti-Corruption Layer）：Sales 的 Customer 翻成 Support 的 Customer，不直接共用。

## 什麼時候才值得拆

**拆**：

- 多個團隊各自負責不同 subdomain
- 同一個詞已經造成 code 混亂
- 業務規則明顯分歧（Sales 規則跟 Support 規則完全不同）

**不拆**：

- 系統規模還小，單一 model 撐得住
- subdomain 邊界還沒清楚，硬拆是猜
- 團隊沒大到一個 BC 一個 squad

教科書本身的話：「**when context boundaries cause friction**, then introduce explicit contexts」。沒摩擦的時候硬拆是 over-engineering。

## 跟 microservices 的關係

會拿來跟 microservices 比，是因為**大家拆 microservice 最常問「邊界畫哪」，而答案就是「照 bounded context 畫」**：按業務領域切，不是按技術分層切。

但兩者不是同一層的東西，別畫等號：

- BC 是**邏輯邊界**（concept-level）：code 裡怎麼分 model
- microservice 是**部署邊界**（process-level）：跑成幾個獨立的服務

所以對應很彈性：可以一個 BC 一個 microservice、可以多個 BC 擠在一個 monolith 用 module 分、也可以一個 BC 跨多個 microservice。DDD 只管邏輯邊界，不規定你部署成幾隻。
