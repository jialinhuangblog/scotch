---
title: "Reverse Proxy"
slug: reverse-proxy
brief: "把後端整群 server 藏在後面，client 只看到一個入口。"
date: 2026-06-12
updated: 2026-10-18
revisions: 2
---

# Reverse Proxy

> 後面有 50 台 server，怎麼讓 client 只需要連一個地方？

## 站在後端前面收請求

reverse proxy 是站在後端 server 群前面的一台機器，接收 client 的請求，再轉給後面對的 server。Nginx、HAProxy、Envoy 是代表。

走一遍。api.example.com 的 DNS 指到 203.0.113.10，這台跑 Nginx。後面 50 台 app server 在內網，10.0.1.1 到 10.0.1.50，外面連不到。瀏覽器對 203.0.113.10 送 `GET /orders/42`，Nginx 收下，照設定挑一台，例如 10.0.1.7，自己開一條連線把請求轉過去，拿到回應再回給瀏覽器。瀏覽器從頭到尾只看到 203.0.113.10，不知道 10.0.1.7 存在。隔天 10.0.1.7 壞了。開源版 Nginx 不會定時去探測後端，它要等轉給 10.0.1.7 的真實請求連線失敗或逾時，預設失敗 1 次，就把這台標成接下來 10 秒不轉，10 秒一過再轉請求給它試試看。失敗的那個請求要是 GET，Nginx 會改送下一台，瀏覽器感覺不到；POST 預設不重送，那一筆會回錯誤。不管哪一種，瀏覽器那邊的設定都不用改。要定時主動探測後端，得用 NGINX Plus 的 `health_check`，或是 HAProxy 這類開源版就有主動檢查的 proxy。

跟 forward proxy 方向相反。forward proxy 替 client 出去連外網，公司內網出口那台就是；reverse proxy 替 server 收進來的請求。

像公司櫃台，所有訪客都先到櫃台，櫃台再帶訪客去找對的人。訪客從頭到尾不知道後面辦公室怎麼排、有幾個人。

## 集中在這裡做的事

因為所有流量都經過它，很多功能放在這裡做最方便：

- [負載平衡](chunk://l4-vs-l7-lb)：上面挑 10.0.1.7 那一步就是，round robin 或看哪台連線最少。
- TLS termination：憑證只裝在 Nginx 這一台，它解密之後，到 10.0.1.7 那段走內網明文或另一層加密，50 台 app 不用各自管憑證。
- 按路徑路由：`/orders` 轉給訂單服務那群，`/search` 轉給搜尋服務那群。
- cache、壓縮、限流，還有把後端有幾台、長怎樣全藏起來。
