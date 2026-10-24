---
title: "IGP (Interior Gateway Protocol)"
slug: igp
brief: "AS 內部的路由協議。RIP 數跳數，OSPF 算最短路徑。"
article: routing-journey
date: 2026-04-08
updated: 2026-10-18
revisions: 4
---

# IGP (Interior Gateway Protocol)

AS 內部的路由協議。讓同一個組織內的 router 知道彼此的路徑。

## 常見的 IGP

| 協議 | 類型 | 成本依據 | 場景 |
|---|---|---|---|
| RIP (Routing Information Protocol) | 距離向量 | hop count（上限 15） | 中小型，教學 |
| OSPF (Open Shortest Path First) | 鏈路狀態 | 頻寬（參考頻寬 ÷ link 頻寬） | 大型，業界主流 |
| IS-IS (Intermediate System to Intermediate System) | 鏈路狀態 | 類似 OSPF | ISP 骨幹 |
| EIGRP (Enhanced Interior Gateway Routing Protocol) | 混合 | 頻寬 + 延遲 | Cisco 環境 |

## OSPF (Open Shortest Path First)：算最短路徑

R1 到 R4 有兩條路。一條直連，中間是一段 100 Mbps 的舊線；另一條繞過 R2、R3，三段都是 10 Gbps。

```text
R1 ──────── 100 Mbps ──────── R4        RIP：1 hop，選這條
R1 ─10G─ R2 ─10G─ R3 ─10G─ R4           OSPF（參考頻寬調成 100 Gbps）：cost 10+10+10 = 30，選這條
```

RIP 只數 hop，直連是 1 跳、繞路是 3 跳，所以選直連，流量全部擠在那條 100 Mbps 的線上。OSPF 的 cost 是參考頻寬除以 link 頻寬，而 Cisco IOS 預設的參考頻寬只有 100 Mbps，100 Mbps 以上的 link 一律算成 cost 1。照預設值算，直連 1、繞路 1+1+1 = 3，OSPF 跟 RIP 一樣選直連。所以網路裡有 10 Gbps link 的時候，會用 `auto-cost reference-bandwidth` 把參考頻寬調高。調成 100 Gbps 的話，10 Gbps 的 link cost 是 10，100 Mbps 的 link cost 是 1000，繞路三段加起來 30，直連 1000，OSPF 才選繞路。每台 router 知道整個 area 的拓撲，用 Dijkstra 自己算，不靠鄰居轉告。

大型網路切成多個 area，area 之間透過 area 0（backbone）串接。變更只在 area 內廣播，收斂快。OSPF 是業界最主流的 IGP。

## 其他成員

RIP 只數 hop、上限 15，分辨不出頻寬差別，現在幾乎只在教學場景出現。IS-IS 和 OSPF 邏輯幾乎一樣，但直接跑在 Layer 2 上，不依賴 IP，是 ISP 骨幹常用的選擇。EIGRP 原本是 Cisco 的專有協議，2016 年才以 RFC 7868 公開，混用廠牌的網路通常不會選它。

## 和 BGP (Border Gateway Protocol) 的關係

IGP 決定 AS 內部怎麼走，BGP 決定 AS 之間怎麼走。同一台 router 可能同時跑 OSPF 和 BGP，這時用 Administrative Distance 決定誰優先。Administrative Distance 是每種協議的可信度分數，數字小的路由優先，例如 eBGP 是 20、OSPF 是 110。
