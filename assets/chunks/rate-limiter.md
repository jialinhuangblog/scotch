---
title: "Rate Limiter"
slug: rate-limiter
brief: "Token bucket 允許 burst，sliding window 嚴格計數。演算法選錯還好，key 選錯更麻煩。"
date: 2026-03-09
article: rate-limiter
---

# Rate Limiter

Rate limiter 要決定的就是這個 client 要不要擋。

頻寬、CPU、DB connection、API quota，這些資源都是有限的。濫用的人不擋，倒楣的是正常用戶。

兩種主流演算法：

**Token Bucket** — 桶裡有固定容量的 token，固定速率補充。request 來拿一個，沒了就擋。安靜一段時間桶會補滿，回來可以 burst。適合大部分 API 場景，因為真實用戶就是會偶爾 burst。

**Sliding Window** — 在時間窗口內記錄每個 request 的 timestamp，數量超過上限就擋。精確計數，不允許 burst。適合計費合約場景。

多機環境下 counter 要放在大家共用的地方（Redis），不然每台 app 各數各的，這個 limiter 根本擋不住。
