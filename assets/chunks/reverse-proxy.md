---
title: "Reverse Proxy"
slug: reverse-proxy
brief: "把後端整群 server 藏在後面，client 只看到一個入口。"
date: 2026-06-12
---

# Reverse Proxy

> 後面有 50 台 server，怎麼讓 client 只需要連一個地方？

## 站在後端前面收請求

reverse proxy 是站在後端 server 群前面的一台，接收 client 的請求，再轉給後面對的 server。Nginx、HAProxy、Envoy 是代表。client 以為自己在跟 server 講話，其實是在跟 proxy 講。

跟 forward proxy（替 client 出去連外網）方向相反：reverse proxy 是替 server 收進來的請求。

像公司櫃台：所有訪客都先到櫃台，櫃台再帶你去找對的人。你從頭到尾不知道後面辦公室怎麼排、有幾個人。

## 順手做一堆事

因為所有流量都經過它，很多事擺在這裡做最順：

- [負載平衡](chunk://l4-vs-l7-lb)：把流量分到多台後端。
- TLS termination：在這裡解密，後端之間走比較單純的連線。
- cache、壓縮、按路徑路由、限流。
- 把後端有幾台、長怎樣全藏起來，外面只看到一個入口。

---

reverse proxy 站在後端前面收所有請求，做負載平衡、TLS、cache、路由，把後面一整排 server 收成對外的一個入口。
