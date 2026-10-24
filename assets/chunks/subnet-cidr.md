---
title: "Subnet & CIDR"
slug: subnet-cidr
brief: "CIDR 用前綴長度表示一段 IP 範圍，subnet 是從 VPC 的 IP 範圍裡切出來的一段。"
date: 2026-03-14
---

# Subnet & CIDR

## CIDR

CIDR（Classless Inter-Domain Routing）用 `10.42.0.0/16` 這種格式表示一段 IP 範圍。`/16` 代表前 16 bit 是固定的，剩下 16 bit 是可用的地址空間，也就是 65,536 個 IP。

```
10.42.0.0/16  → 10.42.0.0 ~ 10.42.255.255 (65,536 IPs)
10.42.0.0/18  → 10.42.0.0 ~ 10.42.63.255  (16,384 IPs)
10.42.0.0/24  → 10.42.0.0 ~ 10.42.0.255   (256 IPs)
```

數字越大，範圍越小。`/16` 是整棟大樓，`/18` 是一層樓，`/24` 是一間辦公室。

## Subnet

Subnet 從 VPC 的 CIDR 裡切出一段。在 AWS 上，每個 subnet 綁定一個 Availability Zone；GCP 的 subnet 則屬於整個 region。

```
VPC: 10.42.0.0/16
├── subnet-nodes:    10.42.0.0/18     (nodes 用)
├── subnet-pods:     10.42.64.0/18    (k8s pods 用)
└── subnet-services: 10.42.128.0/18   (k8s services 用)
```

GKE 的 VPC-native 模式要求 pod 跟 service 各有獨立的 CIDR 段，node 跑在一段，pod IP 在另一段，彼此不重疊。EKS 預設的 VPC CNI 則直接從 node 所在的 subnet 分配 pod IP，service 用的是另一段不在 VPC 裡的 CIDR。

## 規劃原則

多個環境（dev, staging, prod）的 CIDR 不能重疊，因為一旦要建 VPN 或 VPC Peering 互通，路由表需要靠不同的 CIDR 來區分流量該往哪邊送。
