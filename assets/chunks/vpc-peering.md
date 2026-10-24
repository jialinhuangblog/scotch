---
title: "VPC Peering"
slug: vpc-peering
brief: "兩個 VPC 直接互連，不經過 internet、延遲低，但兩邊 CIDR 不能重疊。"
date: 2026-03-14
updated: 2026-10-18
revisions: 2
---

# VPC Peering

兩個 VPC 之間建立直接連線。流量走雲端內部網路，不經過 public internet。

## 使用場景

同一個公司有兩個 VPC：prod VPC 跑 app，managed-service VPC 跑 Redis 跟 DB。app 要連 DB，但不想把 DB 掛公有 IP 暴露到 internet。

```
prod-network VPC (10.42.0.0/16)
        ↕  VPC Peering
managed-service VPC (10.30.0.0/16)
```

peering 建好之後，兩邊的 route table 各要多一條。prod 這邊是 `10.30.0.0/16 → peering 連線`，managed-service 那邊是 `10.42.0.0/16 → peering 連線`。這條 route 誰來加，兩家不一樣。GCP 在 peering 生效時自動交換兩邊的 subnet route。AWS 不會，peering 顯示 Active 之後，兩邊的 owner 還得各自手動加這條 route，沒加的話封包找不到往 10.30.0.0/16 的路。route 都到位之後，prod 裡的 app 10.42.5.8 對 DB 10.30.2.4 送封包，查 route table，目的地落在 10.30.0.0/16，走 peering 那條，封包從頭到尾都是私有 IP，不經過 NAT，也不經過 internet gateway，延遲跟同一個 VPC 內差不多。DB 從頭到尾沒有公有 IP。

GKE 跟 managed Redis、managed DB 之間常用這種模式。GCP 叫 VPC Network Peering，AWS 叫 VPC Peering Connection。

## 限制

**CIDR 不能重疊。** 要是兩個 VPC 都用 10.42.0.0/16，app 要送 10.42.2.4 的時候，路由器分不出這是自己 VPC 裡的機器，還是對面的 DB。所以雲端在建立 peering 那一步就先檢查，AWS 跟 GCP 碰到重疊的 CIDR 都直接拒絕建立。規劃 CIDR 的時候就要錯開，像上面一邊 10.42、一邊 10.30，事後要改 CIDR 等於整個 VPC 重建。

**不能傳遞。** A peering B，B peering C，A 送給 C 的封包到了 B 就停。這是 peering 本身的限制，就算在 B 的 route table 加一條往 C 的 route 也沒用，AWS 跟 GCP 的 peering 都不做傳遞路由。AWS 連 B 的 internet gateway、NAT、VPN 都不讓 A 借用。要 A 到 C，得另外建一條 A 到 C 的 peering。十個 VPC 全互連要 45 條，這時候改用 Transit Gateway 之類的中心點。

**跨雲不行。** VPC Peering 只能在同一個雲端內，AWS 對 AWS，GCP 對 GCP。跨雲互通要用 VPN 或專線。
