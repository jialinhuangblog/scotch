---
title: "NAT Gateway"
slug: nat-gateway
brief: "Private subnet 的出口。內部資源用大樓的公共地址出去，外面看不到房間號。"
date: 2026-03-14
---

# NAT Gateway

Network Address Translation Gateway。讓 private subnet 裡的資源能存取 internet，但 internet 不能主動連進來。

## 運作方式

Private subnet 裡的 EC2（IP `10.42.1.5`）要存取外部 API。封包經過 NAT Gateway，source IP 被改成 NAT Gateway 的公有 IP（例如 `54.x.x.x`）。外部 API 回應時，NAT Gateway 再把封包轉回 `10.42.1.5`。

```
EC2 (10.42.1.5) → NAT Gateway (54.x.x.x) → Internet
                        ↑
                  外部只看到這個 IP
```

## 為什麼不直接用 public subnet

安全性。DB server 不需要也不應該被 internet 直接連到。放在 private subnet，連 SSH 都進不來（除非透過 bastion 或 VPN），但 DB 仍然可以透過 NAT 去下載 patch 或連外部 API。

## 成本

NAT Gateway 按流量計費，是 AWS 帳單上常見的意外支出。大量 outbound 流量時成本會快速累積。有些團隊會用 NAT Instance（自己跑的 EC2）替代，便宜但要自己維護高可用。
