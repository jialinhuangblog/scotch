---
title: "Service Discovery"
slug: service-discovery
brief: "服務怎麼找到彼此。DNS 式（k8s CoreDNS）vs 註冊式（Consul、etcd）。"
date: 2026-03-14
---

# Service Discovery

微服務 A 要呼叫微服務 B。B 的 IP 是什麼？B 有幾個 instance？B 剛 scale up 多了一個，A 怎麼知道？

## 兩種模式

**DNS-based** — k8s 內建。CoreDNS 把 Service name 解析成 ClusterIP。`my-service.default.svc.cluster.local` → `10.96.0.12`。簡單，但 DNS TTL 會造成 stale resolve。

**Registry-based** — Consul、etcd、ZooKeeper。Service 啟動時向 registry 註冊自己的 IP + port。Client 查 registry 拿到可用 instance 列表。Health check 自動移除掛掉的 instance。

## k8s 的 Service Discovery

k8s 用 DNS + kube-proxy 組合。Service 是穩定的虛擬 IP。kube-proxy 維護 iptables/IPVS 規則，把流量導到實際的 Pod IP。Pod 增減時規則自動更新。

呼叫的人只認 Service name，至於背後幾個 Pod、在哪台 node，它不需要知道。
