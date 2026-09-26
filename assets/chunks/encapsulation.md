---
title: "Encapsulation"
slug: encapsulation
brief: "資料從 App 到網卡，每一層加 header。Frame、Packet、Segment 就是這樣來的。"
article: packet-journey
date: 2026-04-07
---

# Encapsulation

送出去的 HTTP request 不會原封不動抵達對面。每一層網路協議都會把它包起來，加上自己的 header，再交給下一層。

## 每層加一個 header，名字跟著換

| 名字 | 層級 | 加了什麼 |
|---|---|---|
| Segment | L4 Transport | TCP header（port、sequence number） |
| Packet | L3 Network | IP header（source IP、destination IP） |
| Frame | L2 Data Link | Ethernet header（source MAC、destination MAC）+ trailer |

Segment 加上 IP header 變成 Packet。Packet 加上 Ethernet header 變成 Frame。只有 Frame 有 trailer（FCS，用來驗證資料完整性）。

## 拆封

對面收到 Frame，反過來做。去掉 Ethernet header 得到 Packet，去掉 IP header 得到 Segment，去掉 TCP header 得到 HTTP request。

每一層只看自己的 header。Switch 看 L2 的 MAC。Router 去掉 L2 header，看 L3 的 IP。Application 只看最裡面的資料。
