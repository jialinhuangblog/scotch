---
title: "VPC"
slug: vpc
brief: "雲端上的私有網路。一棟大樓有自己的內部地址空間，外面看不到裡面。"
date: 2026-03-14
---

# VPC

Virtual Private Cloud。在公有雲上劃出一塊隔離的私有網路。

## 為什麼需要

雲端是共享的。同一台實體機器上可能跑著不同公司的 workload。VPC 在 L3 層做隔離，確保不同租戶的流量互不干擾。

AWS 叫 VPC，GCP 也叫 VPC，概念一樣：一組私有 IP 範圍（CIDR block），只有 VPC 內部的資源能互相通訊。

## 基本結構

```
VPC (10.42.0.0/16)
├── Subnet A (10.42.0.0/18)  ← us-west-1a
├── Subnet B (10.42.64.0/18) ← us-west-1b
└── Internet Gateway          ← 對外出口
```

VPC 定義 CIDR 範圍，Subnet 再從中切出更小的區段，分配到不同的 Availability Zone。

## Public vs Private Subnet

Public subnet 有 route 指向 Internet Gateway，裡面的資源可以有公有 IP。Private subnet 沒有直接對外的 route，要透過 NAT Gateway 才能出去。

大部分的 workload（DB, app server, k8s node）放 private subnet。只有 load balancer 和 bastion host 放 public subnet。
