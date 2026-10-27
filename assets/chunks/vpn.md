---
title: "VPN (Site-to-Site)"
slug: vpn
brief: "跨雲、跨機房的加密隧道。IPSec 加密 + BGP 自動交換路由表。"
date: 2026-03-14
updated: 2026-10-18
revisions: 3
---

# VPN (Site-to-Site)

兩個不同網路之間建立加密隧道。辦公室的網段是 192.168.10.0/24，AWS 上的 VPC 是 10.200.0.0/16，中間隔著 public internet。辦公室一台機器 192.168.10.5 要連 VPC 裡的 10.200.1.20，封包這樣走：

```text
192.168.10.5 → 辦公室的 VPN gateway
  gateway 把整個封包用 IPSec 加密，外面再包一層新的 IP header，
  來源是自己的公開 IP，目的是 AWS gateway 的公開 IP
→ public internet，路上只露出兩個 gateway 的公開 IP 跟一團密文
→ AWS 的 VPN gateway 解密，取出原本的封包
→ 10.200.1.20
```

中間即使被攔截也讀不到內容。連「內網裡誰在跟誰講話」都查不出來，因為內層的 IP header 也一起被加密了。

## 跟 VPC Peering 的差異

VPC Peering 是同一個雲端內部互通，不走 internet。Site-to-Site VPN 是跨雲或跨機房，走 internet 但加密。

```
GCP VPC ←─ VPC Peering ─→ GCP VPC     (同雲，直通)
GCP VPC ←─ VPN tunnel  ─→ AWS VPC     (跨雲，加密隧道)
```

## 建立 VPN 的兩邊各需要什麼

- 自己這邊的 VPN gateway，對外有一個公開 IP
- 對方 gateway 的公開 IP，以及對方的 ASN（下面 BGP 會用到）
- 隧道設定：兩邊共用的 pre-shared key、IKE 版本、加密演算法

## BGP 和 ASN

隧道通了，兩邊的路由器還得知道哪些網段在對面。手動寫死可以，但對面每加一個網段就要改一次。BGP（Border Gateway Protocol）讓兩邊自動交換：辦公室宣告「192.168.10.0/24 在我這邊」，AWS 宣告「10.200.0.0/16 在我這邊」，兩邊的路由表自動更新。之後 AWS 多開一個 10.201.0.0/16，宣告一次就通，辦公室這邊不用改任何設定。

每一邊需要一個 ASN（Autonomous System Number）作為 BGP 的身份識別。兩邊的 ASN 不能相同。

## 為什麼需要多條 tunnel

VPN tunnel 走的是 public internet。ISP 線路斷了、某個節點掛了，tunnel 就斷了。如果只有一條 tunnel，VPN 斷 = 兩邊斷聯。

AWS 的每條 Site-to-Site VPN connection 會自動建 2 條 tunnel。這 2 條在 AWS 那端落在兩個不同的 Availability Zone，用的是不同的公開 IP，所以 AWS 那端一個 endpoint 進維護的時候，流量會自動改走另一條。辦公室這端就沒有這層保護，兩條 tunnel 接的是同一台 customer gateway、同一條 ISP 線路，線路一斷兩條一起斷。要防這一端的故障，AWS 文件的做法是再建第二條 VPN connection，接到第二台 customer gateway。

GCP 的 HA VPN Gateway 有 2 個 IP（普通的 Cloud VPN Gateway 只有 1 個）。GCP 接 AWS 的官方教學也是在 AWS 建兩個 customer gateway、兩條 VPN connection，GCP 的第一個 IP 接第一條 connection 的 2 條 tunnel，第二個 IP 接第二條的 2 條，總共 4 條。任一條斷掉，BGP 把流量切到其他還通的 tunnel。
