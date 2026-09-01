---
title: "VPC Peering"
slug: vpc-peering
brief: "像隔壁兩棟樓開一道側門直接走，不經過 internet、延遲低，但兩邊 CIDR 不能重疊。"
date: 2026-03-14
---

# VPC Peering

兩個 VPC 之間建立直接連線。流量走雲端內部網路，不經過 public internet。

## 使用場景

同一個公司有多個 VPC：prod VPC 跑 app，managed-service VPC 跑 Redis 和 DB。兩邊需要互通，但不想把 DB 暴露到 internet。VPC Peering 讓兩邊的 private IP 可以直接互相連。

```
prod-network VPC (10.42.0.0/16)
        ↕  VPC Peering
managed-service VPC (10.30.0.0/16)
```

GKE 和 managed Redis / managed DB 之間常用這種模式。GCP 叫 VPC Network Peering，AWS 叫 VPC Peering Connection。

## 限制

**CIDR 不能重疊。** 兩個 VPC 都用 `10.0.0.0/16` 的話，路由表不知道封包該留在本地還是送到對面。

**不能傳遞。** A peering B，B peering C，A 不能透過 B 到 C。要 A 到 C，得另外建一條 peering。

**跨雲不行。** VPC Peering 只能在同一個雲端內（AWS 對 AWS，GCP 對 GCP）。跨雲互通要用 VPN 或專線。
