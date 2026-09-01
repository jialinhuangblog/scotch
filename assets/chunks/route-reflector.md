---
title: "Route Reflector"
slug: route-reflector
brief: "解決 iBGP full mesh 的擴展問題。一台集中轉發，不用 n(n-1)/2 條連線。"
article: routing-journey
date: 2026-04-10
updated: 2026-06-15
revisions: 1
---

# Route Reflector

iBGP 有個規則：從 iBGP 鄰居學到的路由，不能再轉給其他 iBGP 鄰居。這是為了防止迴圈。

但這代表每台 router 都要跟其他所有 router 建 iBGP session → full mesh。

## Full Mesh 的麻煩

```text
5 台 router → 5×4/2 = 10 條 iBGP session
20 台 router → 20×19/2 = 190 條
100 台 router → 100×99/2 = 4950 條
```

ISP 骨幹動輒上百台 router。4950 條 session，每條都要維護 TCP 連線、交換路由更新，數量一多根本維護不過來。

## Route Reflector 怎麼解

指定一台（或少數幾台）router 當 route reflector（RR）。其他 router 當 client，只跟 RR 建 iBGP session。

```text
Full Mesh (5 台):            Route Reflector (5 台):

 R1 ── R2                       R1   R2
 │╲  ╱│                           ╲  ╱
 │  R3 │                           RR
 │╱  ╲│                           ╱  ╲
 R4 ── R5                       R3   R4

10 條 session                   4 條 session
                            （RR 是 5 台裡指定的一台）
```

Client 把路由傳給 RR，RR「反射」給其他 client。打破了「iBGP 不轉發」的限制，但用 cluster-id 和 originator-id 防止迴圈。

## 實務部署

- 通常部署兩台 RR 做冗餘，一台掛了另一台接手
- RR 不一定在轉發路徑上 — 它只反射路由資訊，封包不一定經過它
- RR 的 client 不需要知道彼此存在，降低設定複雜度

## 和 IGP 的關係

RR 解決的是 iBGP 的擴展問題，不影響 IGP。IGP（OSPF、IS-IS）照常跑，負責內部路徑。RR 只處理「外部路由資訊在 AS 內部怎麼散佈」。
