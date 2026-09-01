---
title: "ARP (Address Resolution Protocol)"
slug: arp
brief: "知道 IP 但不知道 MAC。ARP 用廣播問，問到就存。"
article: packet-journey
date: 2026-04-07
updated: 2026-07-20
revisions: 2
---

# ARP (Address Resolution Protocol)

你知道 gateway 的 IP 是 `192.168.1.1`。但 Ethernet frame 的 header 要填 MAC 位址，IP 填不進去。ARP 負責把 IP 翻成 MAC。

## 怎麼問

1. 筆電廣播 ARP request：「誰的 IP 是 `192.168.1.1`？告訴我你的 MAC。」
2. `192.168.1.1` 回覆 ARP reply：「我的 MAC 是 `AA:BB:CC:DD:EE:FF`。」
3. 筆電把這個 IP → MAC 配對存進 ARP cache。
4. 下次送封包給同一個 IP，直接查表，不用再廣播。

ARP 只在 LAN 內運作。跨網段的目的地你不需要知道對方的 MAC，只需要知道 gateway 的 MAC，封包先送給 gateway，router 接力往外送。

## ARP cache 的生命週期

ARP cache 的 entries 不是永久的，有過期機制：

- **macOS**：預設 ~20 分鐘沒流量就刪
- **Linux**：60 秒後進入 stale 狀態，需要時重新探測；~10 分鐘完全過期

過期是為了應付 device 下線或 IP 重新分配。你的 ARP cache 是**當下可達的鄰居快照**，不是歷史紀錄。

## ARP cache 和 routing table 的分工

兩個容易混淆，分工其實很清楚：

| | Routing table | ARP cache |
|---|---|---|
| 決定什麼 | 要從哪個介面出去、下一跳 gateway 是誰 | 下一跳的 MAC 是什麼 |
| 用什麼匹配 | 目的地 IP（longest prefix match）| 下一跳 IP |
| 何時用 | 準備送封包的第一步 | routing 決定好之後 |

流程：

1. 你要送封包到 `8.8.8.8`。
2. 查 routing table：走 en0，下一跳交給 gateway `192.168.0.1`。
3. 查 ARP cache：`192.168.0.1` 的 MAC 是 `fa:34:5a:6a:92:24`。
4. 組 Ethernet frame：dst MAC = `fa:34:5a:6a:92:24`，dst IP = `8.8.8.8`。
5. 從 en0 送出去。

Route 決定**方向**，ARP 決定**下一跳怎麼寫 frame**。

## IPv6 的替代

IPv6 沒有 ARP。用 **NDP (Neighbor Discovery Protocol)** 取代，基於 ICMPv6，改用 multicast 不再廣播。行為和角色都和 ARP 類似，只是在 IPv6 stack 裡。

## 和 DHCP 的分工

[DHCP](chunk://dhcp) 解決「我還沒有 IP」，ARP 解決「我知道 IP 怎麼找到 MAC」。接入網路的順序：DHCP 先給你 IP + gateway + DNS，之後每次送封包 ARP 才上場找 MAC。
