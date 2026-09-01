---
title: "API Gateway"
slug: api-gateway
brief: "單一入口。認證、限流、路由，都在你的 code 之前。"
date: 2026-04-07
updated: 2026-06-09
revisions: 1
---

# API Gateway

微服務架構下，client 不該知道後面有幾個 service、每個 service 的地址是什麼。API Gateway 是唯一入口。client 只跟 gateway 溝通，gateway 把 request 轉到對的 service。

```text
Client → API Gateway → user-service
                     → order-service
                     → payment-service
```

## 跟 Load Balancer 和 Reverse Proxy 的差別

三個常搞混。差別在「做多少事」：

| 角色 | 層級 | 做什麼 | 看什麼 |
|---|---|---|---|
| [L4 LB](chunk://l4-vs-l7-lb) | L4 | 按連線分流量 | IP + port |
| L7 LB | L7 | 按內容分流量 | URL、header |
| [Reverse Proxy](chunk://reverse-proxy) | L7 | 轉發 + 隱藏後端 + TLS 終結 | HTTP request |
| API Gateway | L7 | 上面這些 + 認證 + 限流 + 轉換 + 監控 | HTTP + business context |

L7 LB 和 reverse proxy 機制幾乎一樣，都讀 HTTP、都能按內容轉發，差在側重點：一個強調把流量平均分給多台，一個強調當門面、藏後端。Nginx、Envoy 一個 process 兩件事一起做。

Reverse proxy 是 gateway 的子集。Gateway 多了 business-aware 的功能。實務上界線模糊：Nginx 加上 auth module 和 rate limiting 就像 gateway 了。但專門的 gateway（Kong、AWS API Gateway）把這些功能做得更完整。

## Gateway 做的事

**認證（Authentication）**：驗 JWT token、API key。不合法的 request 在 gateway 就擋掉，不會碰到後端 service。

**限流（[Rate Limiting](chunk://rate-limiter)）**：每個用戶每秒最多 100 個 request。超過的回 429。保護後端不被打爆。

**路由（Routing）**：`/api/users` → user-service，`/api/orders` → order-service。Client 不需要知道 service 的真實地址。

**Request/Response 轉換**：Client 送的 request 格式和 service 期望的不一樣？Gateway 中間轉換。合併多個 service 的 response 回傳給 client（BFF pattern）。

**監控**：所有流量經過同一點。在這裡加 logging、metrics、tracing 最省力。

## 代價

**單點故障。** 所有流量經過 gateway。它掛了，整個系統不可用。必須做高可用（多實例 + health check）。

**延遲。** 多了一跳。認證、限流、轉換都要時間。通常 1-5ms，但累積起來有感。

**複雜度。** Gateway 的 routing rule 和 rate limit policy 要維護。團隊多了，rule 多了，gateway 會變成組織上的瓶頸：每次改 routing 都要跟 gateway team 協調，不是它跑不動，是流程卡住。

## 什麼時候需要

- 微服務架構，多個 service 需要統一入口 → 需要
- 單體應用，一個 service → reverse proxy 就夠了，不需要 gateway
- 需要跨 service 的認證和限流 → 需要
- 每個 service 自己處理認證和限流 → 不需要（但重複造輪子）

大部分走微服務的團隊最終都會需要 gateway。問題只是用現成的（Kong、AWS API Gateway）還是自己寫。自己寫通常是錯的選擇。
