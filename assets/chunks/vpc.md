---
title: "VPC"
slug: vpc
brief: "雲端上的私有網路。VPC 有自己的私有 IP 範圍，外部無法直接存取裡面的資源。"
date: 2026-03-14
updated: 2026-10-18
revisions: 2
---

# VPC

VPC（Virtual Private Cloud）是在公有雲上劃出的一塊隔離的私有網路。

## 為什麼需要

雲端是共享的。同一台實體機器上可能跑著不同公司的 workload，兩家公司的 VM 都拿到 10.42.0.5 這個 IP 也很正常，因為各自在自己的 VPC 裡，封包出了 VM 就被打上 VPC 的標記，底層網路只會把它送到同一個 VPC 裡的機器。AWS 叫 VPC，GCP 也叫 VPC，概念一樣：一組私有 IP 範圍（CIDR block），只有 VPC 內部的資源能互相通訊。

## 基本結構

```
VPC (10.42.0.0/16)
├── Subnet A (10.42.0.0/18)  ← us-west-1a，public
├── Subnet B (10.42.64.0/18) ← us-west-1b，private
└── Internet Gateway          ← 對外出口
```

VPC 定義 CIDR 範圍，這裡是 10.42.0.0/16，共 65,536 個 IP。Subnet 再從中切出更小的區段，Subnet A 拿 10.42.0.0 到 10.42.63.255，Subnet B 拿 10.42.64.0 到 10.42.127.255。AWS 的 subnet 各自綁一個 Availability Zone，GCP 的 subnet 則涵蓋整個 region。

## Public vs Private Subnet

在 AWS 上，兩個 subnet 的差別只在 route table。Subnet A 的 route table 有一條 `0.0.0.0/0 → Internet Gateway`，Subnet B 的 route table 沒有這條，只有 `0.0.0.0/0 → NAT Gateway`。

GCP 不一樣。GCP 的 route table 定在整個 VPC network 上，同一個 network 裡的 subnet 共用一份，沒辦法替單一 subnet 掛自己的 route table。所以 GCP 的 public 跟 private 看的是 VM 有沒有 external IP：有的話直接走 default route 出去，沒有的話要靠 Cloud NAT 才能連到 internet。下面的走查用的是 AWS 的做法。

拿兩個封包走一遍。Subnet B 裡的 app server 10.42.70.3 要去抓 pypi 的套件。封包的目的地不在 10.42.0.0/16 裡，查 route table 走 NAT Gateway，NAT Gateway 把來源換成自己的公有 IP 再送出 Internet Gateway，回應回來 NAT 再換回 10.42.70.3。外面看到的只有 NAT 的公有 IP。

反過來，internet 上有人直接對 10.42.70.3 送封包。這是私有 IP，internet 上根本沒有路由到它，而且 NAT Gateway 只會放行自己送出去的連線的回應，所以這個封包到不了。同一個 VPC 裡 Subnet A 的 load balancer 送給 10.42.70.3 就通，因為目的地在 10.42.0.0/16 裡，走 VPC 內部那條 route。

所以大部分的 workload，DB、app server、k8s node，放 private subnet，從裡面出得去，外面進不來。只有 load balancer 跟 bastion host 放 public subnet，掛公有 IP，給外面進來的那一個入口。
