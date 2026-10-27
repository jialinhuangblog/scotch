---
title: "Rate Limiter"
slug: rate-limiter
brief: "Token bucket 允許 burst，sliding window 嚴格計數。多台機器要共用同一個 counter。"
date: 2026-03-09
updated: 2026-10-17
revisions: 2
article: rate-limiter
---

# Rate Limiter

Rate limiter 決定某個 client 送來的這一個 request 收不收。頻寬、CPU、DB connection、API quota 都是有限的，要是不限制用太兇的 client，資源用完之後，受影響的是正常用戶。

兩種主流演算法，用同一條規則走一遍：每個 client 每分鐘 60 次。

**Token bucket。** 每個 client 一個桶，容量 60，每秒補一顆 token。request 來就拿走一顆，桶空了就回 429。某個 client 安靜了兩分鐘，桶補滿到 60，接著在第 0 秒一口氣送 60 個 request，全部通過，第 61 個才被拒絕。之後每秒補一顆，所以每秒再放行一個。從第 0 秒算起的這一分鐘，總共放行 60 + 59 = 119 個，差不多是規則寫的兩倍。token bucket 允許 burst，實際上限是「平均每分鐘 60，瞬間最多 60」。大部分 API 用這個，因為真實用戶就是打開頁面那一下會同時送出一批請求。

**Sliding window。** 每個 client 記下最近 60 秒內每個 request 的時間戳。新的 request 進來，先把 60 秒前的紀錄丟掉，剩下的數量滿 60 就拒絕。同一個 client 在第 0 秒送 60 個，一樣全過，但第 61 個要等到第 60 秒，第一筆紀錄掉出窗口之後才放行。任何 60 秒的窗口裡都不會超過 60 次，適合按次計費的合約，因為帳單上的數字跟規則完全對得上。

**多台機器。** 有 50 台 app server，各自在自己的記憶體裡數。一個 client 每分鐘送 3000 個 request，平均分到 50 台，每台只看到 60 個，每台都說沒超過，加起來卻是上限的 50 倍。所以 counter 要放在大家共用的地方，通常是 Redis，50 台都去同一個 key 扣。
