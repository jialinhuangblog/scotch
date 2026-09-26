---
title: "Rate Limiter"
slug: rate-limiter
brief: "Token bucket 允許 burst，sliding window 嚴格計數。多台機器要共用同一個 counter。"
date: 2026-03-09
article: rate-limiter
---

# Rate Limiter

Rate limiter 要決定的是某個 client 的 request 收不收。

頻寬、CPU、DB connection、API quota，這些資源都是有限的。要是不限制濫用的 client，資源被用光之後，受影響的是正常用戶。

兩種主流演算法：

**Token Bucket** — 桶裡有固定容量的 token，以固定速率補充。request 來就拿一個，沒有 token 就拒絕。安靜一段時間桶會補滿，回來可以 burst。適合大部分 API 場景，因為真實用戶就是會偶爾 burst。

**Sliding Window** — 在時間窗口內記錄每個 request 的 timestamp，數量超過上限就拒絕。它精確計數、不允許 burst，適合計費合約場景。

多機環境下 counter 要放在大家共用的地方（Redis）。不然每台 app 只數得到自己那份流量，加起來早就超過上限了也不會發現。
