---
title: "Encapsulation"
slug: encapsulation
brief: "資料從 App 到網卡，每一層加 header。Frame、Packet、Segment 就是這樣來的。"
article: packet-journey
date: 2026-04-07
---

# Encapsulation

你送出一段 HTTP request。它不是直接飛到對面。每一層網路協定把它包起來，加上自己的 header，交給下一層。

## 三個名字，三個階段

| 名字 | 層級 | 加了什麼 |
|---|---|---|
| Segment | L4 Transport | TCP header（port、sequence number） |
| Packet | L3 Network | IP header（source IP、destination IP） |
| Frame | L2 Data Link | Ethernet header（source MAC、destination MAC）+ trailer |

Segment 加上 IP header 變成 Packet。Packet 加上 Ethernet header 變成 Frame。只有 Frame 有 trailer（FCS，用來驗證資料完整性）。

## 拆封

對面收到 Frame，反過來做。剝掉 Ethernet header 拿到 Packet，剝掉 IP header 拿到 Segment，剝掉 TCP header 拿到 HTTP request。

每一層只看自己的 header。Switch 看 L2 的 MAC。Router 剝開 L2 看 L3 的 IP。Application 只看最裡面的資料。
