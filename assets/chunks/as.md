---
title: "AS"
slug: as
brief: "自治系統。網際網路是很多塊各自管的網路拼出來的。"
article: routing-journey
date: 2026-04-08
updated: 2026-07-20
revisions: 2
---

# AS

整個網際網路被切成一塊一塊，每一塊叫 AS（Autonomous System）。

## 什麼是 AS

一個獨立管理的網路。ISP 是一個 AS。大型企業可能有自己的 AS。Google 是 AS15169，Cloudflare 是 AS13335。

每個 AS 有一個編號（ASN），長度是 16-bit 或 32-bit。IANA 把號碼段分給各區的 RIR（Regional Internet Registry，例如亞太區的 APNIC），再由 RIR 分配給各組織。

有幾個？目前約 [8 萬個 AS](https://www.cidr-report.org/as2.0/) 真的在 BGP 表上對外宣告路由，分配出去的 [ASN 約 12 萬](https://en.wikipedia.org/wiki/Autonomous_system_(Internet))（拿了號不一定在用）。

## 為什麼要切

因為規模。全球幾十億台裝置，不可能用同一套路由協議管。切成 AS 之後，每個 AS 內部自己選路，用的是 IGP（Interior Gateway Protocol，例如 OSPF），AS 之間則用 BGP 交換「誰能到哪個網段」。

一個 AS 內部的路由怎麼走，其他 AS 不需要知道。

## 類比

AS 像國家。國內交通自己管（高鐵、公路 = IGP）。國際航線靠航空協定（= BGP）。日本國內怎麼搭新幹線，美國不需要知道。

## References

- [Wikipedia: Autonomous system (Internet)](https://en.wikipedia.org/wiki/Autonomous_system_(Internet)) — 已分配的 ASN 數（2025 約 12 萬）
- [CIDR Report](https://www.cidr-report.org/as2.0/) — 宣告中的 AS 數
