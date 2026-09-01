---
title: "VPN (Site-to-Site)"
slug: vpn
brief: "跨雲、跨機房的加密隧道。IPSec 加密 + BGP 自動交換路由表。"
date: 2026-03-14
updated: 2026-07-20
revisions: 1
---

# VPN (Site-to-Site)

兩個不同網路之間建立加密隧道。封包從一端進去，IPSec 加密，走 public internet 到另一端，解密出來。中間即使被攔截也看不到內容。

## 跟 VPC Peering 的差異

VPC Peering 是同一個雲端內部互通，不走 internet。Site-to-Site VPN 是跨雲或跨機房，走 internet 但加密。

```
GCP VPC ←─ VPC Peering ─→ GCP VPC     (同雲，直通)
GCP VPC ←─ VPN tunnel  ─→ AWS VPC     (跨雲，加密隧道)
```

## 建立 VPN 的兩邊各需要什麼

每一邊都需要三樣東西：自己的 VPN 端點、對方的資訊、隧道設定。

## BGP 和 ASN

BGP（Border Gateway Protocol）讓兩邊自動交換路由表。GCP 說「10.42.0.0/16 在我這邊」，AWS 說「10.200.0.0/16 在我這邊」，兩邊的路由表自動更新。

每一邊需要一個 ASN（Autonomous System Number）作為 BGP 的身份識別。兩邊的 ASN 不能相同。

## 為什麼需要多條 tunnel

VPN tunnel 走的是 public internet。ISP 線路斷了、某個節點掛了，tunnel 就斷了。如果只有一條 tunnel，VPN 斷 = 兩邊斷聯。

所以 AWS 的每條 Site-to-Site VPN 自動建 2 條 tunnel（走不同的 endpoint），確保一條斷了另一條接手。

GCP 更進一步：HA VPN Gateway 有 2 個 IP（普通的 Cloud VPN Gateway 只有 1 個）。兩邊組合起來就是 4 條 tunnel，任一條斷掉流量自動切換。
