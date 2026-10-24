---
title: "Service Discovery"
slug: service-discovery
brief: "服務怎麼找到彼此。DNS 式（k8s CoreDNS）vs 註冊式（Consul、etcd）。"
date: 2026-03-14
updated: 2026-10-18
revisions: 3
---

# Service Discovery

訂單服務要呼叫庫存服務。庫存服務原本有 3 個 instance，IP 是 10.1.2.7、10.1.3.4、10.1.5.9，昨天 scale up 之後多了一個 10.1.6.2，現在是四個，明天可能又少一個。訂單服務的 code 裡不可能寫死這些 IP，所以需要一個地方隨時回答「庫存服務現在在哪」。

## DNS 式跟註冊式

**DNS-based** 用 k8s 內建的 CoreDNS。訂單服務只知道一個名字 `inventory`，發出請求前先問 DNS，CoreDNS 回 `inventory.default.svc.cluster.local` → `10.96.0.12`。這個 10.96.0.12 不是任何一個 Pod，是 Service 的 ClusterIP，一個不會變的虛擬 IP。訂單服務往 10.96.0.12 送，封包出去的時候，node 上 kube-proxy 維護的 iptables 或 IPVS 規則把目的地改寫成 10.1.2.7、10.1.3.4、10.1.5.9、10.1.6.2 其中一個。Pod 增減的時候，改的是 kube-proxy 的規則，DNS 回的 ClusterIP 不變，所以 client 不會拿到過期的答案。

把 DNS 直接指到 instance 的 IP 就不一樣了，例如 VM 時代一個名字後面掛三個 A record。DNS 的答案帶 TTL，假設 60 秒。10.1.5.9 在第 10 秒掛掉，從 DNS 拿掉了，但訂單服務第 5 秒才問過，快取還沒過期，接下來 55 秒它還是會往 10.1.5.9 送，每次都 timeout。

**Registry-based** 用 Consul、etcd、ZooKeeper 這類 registry。庫存服務的 instance 啟動時自己去 registry 登記「我是 inventory，10.1.6.2:8080」。訂單服務直接問 registry 要 inventory 的完整名單，拿到四個 IP 自己挑一個，或是對 registry 開 watch，名單一變就收到通知。

掛掉的 instance 怎麼從名單消失，三套做法不一樣。Consul 由 agent 主動檢查，例如每 10 秒對 10.1.6.2:8080 打一次 HTTP，檢查失敗就把它標成不健康，查詢健康的 instance 時不會回它。etcd 不會主動檢查誰，instance 登記時跟 etcd 拿一個 lease，例如 TTL 10 秒，之後自己定期續約；instance 一掛，續約就停了，10 秒後 lease 到期，etcd 把這筆登記刪掉。ZooKeeper 的做法接近 etcd，instance 建一個 ephemeral node，建它的那個 session 一結束，node 就被刪掉。etcd 這個 TTL 跟上面 DNS 的 TTL 不是同一回事。DNS 的 TTL 是 client 快取答案多久，過期前 client 不會再問；etcd 的 TTL 是 registry 等續約等多久，登記一刪，watch 的 client 馬上收到通知。所以掛掉的 instance 頂多過一個 TTL 或一次檢查週期就從名單消失，不會像上面 DNS 的例子那樣，因為 client 的快取又被呼叫 55 秒。

## k8s 的 Service Discovery

k8s 是 DNS 加 kube-proxy 的組合：名字由 CoreDNS 解析成固定的 ClusterIP，ClusterIP 到實際 Pod 由 kube-proxy 的規則轉發，Pod 增減時規則自動更新。呼叫的人只認 Service name，背後幾個 Pod、在哪台 node，它不需要知道。
