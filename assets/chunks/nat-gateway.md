---
title: "NAT Gateway"
slug: nat-gateway
brief: "Private subnet 的出口。內部資源用 NAT Gateway 的公有 IP 連外，外部看不到內部 IP。"
date: 2026-03-14
updated: 2026-10-17
revisions: 1
---

# NAT Gateway

NAT Gateway（Network Address Translation Gateway）讓 private subnet 裡的資源能連出 internet，internet 卻不能主動連進來。

## 運作方式

Private subnet 裡的 EC2（IP 10.42.1.5）要呼叫外部 API 203.0.113.80 的 443 port。10.42.x.x 是私有位址，internet 上的 router 不認得，封包就算送出去也沒人會回。所以 private subnet 的路由表把 0.0.0.0/0 指到 NAT Gateway。

封包經過 NAT Gateway 時，source 從 10.42.1.5:40001 改成 NAT Gateway 自己的公有 IP 加上一個它挑的 port，例如 54.10.20.30:61000，然後在自己的表裡記一列：

```text
內部                 對外
10.42.1.5:40001   ↔  54.10.20.30:61000  → 203.0.113.80:443
10.42.1.7:40001   ↔  54.10.20.30:61001  → 203.0.113.80:443
```

外部 API 看到的來源是 54.10.20.30:61000，回應也送到這裡。NAT Gateway 查表，61000 對應 10.42.1.5:40001，把 destination 改回去送進 subnet。另一台 EC2 10.42.1.7 剛好也用 40001 連同一個 API，NAT 給它 61001，兩條連線靠對外的 port 分開，所以一個公有 IP 能服務整個 subnet。

反方向為什麼進不來？internet 上有人直接對 54.10.20.30:62000 送封包，表裡沒有這一列，NAT Gateway 不知道要轉給誰，直接丟掉。

## 為什麼不直接用 public subnet

DB server 不需要，也不應該被 internet 直接連到。放在 private subnet，連 SSH 都進不來（除非透過 bastion 或 VPN），但 DB 仍然可以透過 NAT 去下載 patch 或連外部 API。

## 成本

NAT Gateway 按使用時數加上處理的流量計費，是 AWS 帳單上常見的意外支出。大量 outbound 流量時成本會快速累積。有些團隊會用 NAT Instance（自己跑的 EC2）替代，便宜但要自己維護高可用。
