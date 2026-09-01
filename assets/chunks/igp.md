---
title: "IGP (Interior Gateway Protocol)"
slug: igp
brief: "AS 內部的路由協定。RIP 數跳數，OSPF 算最短路徑。"
article: routing-journey
date: 2026-04-08
updated: 2026-07-20
revisions: 2
---

# IGP (Interior Gateway Protocol)

AS 內部的路由協定。讓同一個組織內的 router 知道彼此的路徑。

## 四個成員

| 協定 | 類型 | 成本依據 | 場景 |
|---|---|---|---|
| RIP (Routing Information Protocol) | 距離向量 | hop count（上限 15） | 中小型，教學 |
| OSPF (Open Shortest Path First) | 鏈路狀態 | 頻寬 | 大型，業界主流 |
| IS-IS (Intermediate System to Intermediate System) | 鏈路狀態 | 類似 OSPF | ISP 骨幹 |
| EIGRP (Enhanced Interior Gateway Routing Protocol) | 混合 | 頻寬 + 延遲 | Cisco 環境 |

## OSPF (Open Shortest Path First) — 算最短路徑

OSPF 用 Dijkstra 算最短路徑，成本依據是頻寬：10 Gbps 的 link cost 比 100 Mbps 低。每台 router 知道整個 area 的拓撲，自己算路徑，不靠鄰居轉告。

大型網路切成多個 area，area 之間透過 area 0（backbone）串接。變更只在 area 內廣播，收斂快。業界最主流的 IGP。

## 其他成員

RIP 只數 hop、上限 15，看不出頻寬差別，現在幾乎只在教學場景看到。IS-IS 和 OSPF 邏輯幾乎一樣，但跑在 Layer 2 不依賴 IP，是 ISP 骨幹的選擇。EIGRP 早期是 Cisco 專利，生態已經固化，混用廠牌的網路不會選它。

## 和 BGP (Border Gateway Protocol) 的關係

IGP 管 AS 內部怎麼走。BGP 管 AS 之間怎麼走。同一台 router 可能同時跑 OSPF 和 BGP，用 Administrative Distance 決定誰優先。
