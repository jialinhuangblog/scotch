---
title: "DNS"
slug: dns
brief: "名稱解析。也用於負載均衡和容錯切換。"
article: dns-journey
date: 2026-03-09
updated: 2026-04-08
revisions: 1
---

# DNS

人習慣記名字，機器要的是位址。翻譯只是 DNS 的一部分，它做的不只這些。

## 解析怎麼跑的

Client 問 `api.example.com`，查詢沿著層級往上走：

```
瀏覽器 cache → OS cache → Recursive resolver → Root → .com TLD → example.com 權威伺服器
```

每一層都能用 cache 短路。TTL 決定 cache 多久過期。

## 不只是查名字

**負載均衡。** 回傳多筆 A record，client 自己挑一個。Round-robin DNS 不需要 load balancer 就能分流，但很粗糙：沒有 health check，沒有權重。

**容錯切換。** Health-checked DNS（Route 53、Cloudflare）把不健康的 IP 從回應中移除。切換速度取決於 TTL。TTL 設 300 秒，最久要 5 分鐘，這段時間都還指著已經掛掉的 server。

**地理路由。** 根據 resolver 的位置回傳最近的機房 IP。CDN 重度依賴這個。

## 代價

**TTL 設多長是個取捨。** 低 TTL（30s）切換快，但查詢量大；高 TTL（3600s）省查詢，但掛了復原慢。

**DNS 是信任的單點。** Cache poisoning 可以注入假記錄。DNSSEC 用簽章防止，但普及率還不夠。

## 什麼時候重要

每個 service call 都從 DNS 開始。TTL 要有意識地設。multi-region 容錯靠 health-checked DNS。所謂 "zero-downtime migration"，前提是 TTL 夠短，切換才夠快。
