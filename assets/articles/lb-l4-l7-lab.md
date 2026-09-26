---
title: "同一套 HAProxy，改一行 config 就從 L4 變 L7"
slug: lb-l4-l7-lab
subtitle: "mode tcp 只會把連線輪流分出去，mode http 讀得到 URL。gRPC 分流和 canary 部署的流量比例，都只有 mode http 能做。"
chapter: "networking"
tags: [load-balancer, haproxy, nginx, l4, l7, grpc, canary]
date: 2026-07-20
related: [network-devices-by-layer]
---

# 同一套 HAProxy，改一行 config 就從 L4 變 L7

L4 跟 L7 的 load balancer 可以是同一套 HAProxy，改一行 config 就能切換。

## L4 跟 L7 讀得到什麼

[L4 load balancer](chunk://l4-vs-l7-lb) 工作在 [TCP](chunk://tcp)/UDP，讀得到 IP、port 跟連線狀態，但不讀 payload。它以連線為單位做決定，同一條連線的所有封包都送到同一個 backend。因為不解析 header、也不暫存 body，NAT 等級的轉送每秒能處理數百萬條連線。AWS NLB、HAProxy TCP mode、Linux IPVS 都屬於這種。

L7 load balancer 會終結連線，讀應用層協議，所以讀得到 URL、header、cookie。它以 request 為單位做決定，同一條 HTTP/2 連線上的不同 request 可以送到不同 backend。AWS ALB、Nginx、Envoy、HAProxy HTTP mode 都屬於這種。

## 實測 L4：mode tcp

在本機跑兩個 Express server，同一份 code、不同 port：

```bash
PORT=1234 node app.js   # server 1
PORT=5678 node app.js   # server 2
```

HAProxy 設定（tcp.cfg）：

```text
defaults
    mode tcp

frontend localnodes
    bind *:80
    default_backend nodes

backend nodes
    server server1 127.0.0.1:1234 check
    server server2 127.0.0.1:5678 check
```

`mode tcp` 底下 HAProxy 不讀 HTTP 內容，只把 TCP 連線輪流分出去。curl 幾次，會輪流看到兩個 server 回應：

```bash
$ curl localhost
<h1>listening at port 1234</h1>
$ curl localhost
<h1>listening at port 5678</h1>
$ curl localhost
<h1>listening at port 1234</h1>
```

這跟 switch 轉送 frame 一樣，不看內容，照規則分出去。

## 實測 L7：mode http

這次是兩個不同的 service，每個 service 起兩個 instance：

```bash
PORT=1111 node my-first-service.js    # first-service instance 1
PORT=2222 node my-first-service.js    # first-service instance 2
PORT=3333 node my-second-service.js   # second-service instance 1
PORT=4444 node my-second-service.js   # second-service instance 2
```

HAProxy 設定（http.cfg）：

```text
defaults
    mode http

frontend localnodes
    bind *:9999
    acl app1 path_end -i /first-service
    acl app2 path_end -i /second-service
    use_backend first_service_servers if app1
    use_backend second_service_servers if app2

backend first_service_servers
    server s1 127.0.0.1:1111 check
    server s2 127.0.0.1:2222 check

backend second_service_servers
    server s1 127.0.0.1:3333 check
    server s2 127.0.0.1:4444 check
```

`mode http` 底下 HAProxy 會讀 URL path，根據 `/first-service` 或 `/second-service` 路由到不同的 backend group。每個 group 內部再 round-robin：

```bash
$ curl localhost:9999/first-service
<h1>First service at 1111</h1>
$ curl localhost:9999/first-service
<h1>First service at 2222</h1>
$ curl localhost:9999/second-service
<h1>Second service at 3333</h1>
```

兩次用的是同一套 HAProxy，差別只有 `mode tcp` 跟 `mode http`。HTTP mode 多拆了一層、讀得到 URL，所以才能寫「按路徑分服務」這種規則。[前篇](article://network-devices-by-layer)說拆封包拆到第幾層決定它是什麼設備，這兩次 curl 就是實例。

實務上不需要分兩個 config。一個 `haproxy.cfg` 裡同時定義 TCP 和 HTTP frontend，各綁不同 port，同一個 process 同時處理兩種模式。

## HAProxy vs Nginx

| | HAProxy | Nginx |
|---|---|---|
| 定位 | 專職 load balancer | Web server + reverse proxy |
| L4 TCP | 強項 | 能做，但非主力 |
| L7 HTTP | 能做 | 強項 |
| 靜態檔案 | 不行 | 能直接 serve HTML/CSS/JS |
| Health check | 內建，細緻 | 基本的 |

Nginx 是「web server 兼 [reverse proxy](chunk://reverse-proxy)」，能 serve 靜態網站也能反向代理。HAProxy 是「專職 load balancer」，不 serve 任何內容，只負責分配流量。很多架構兩個一起用：Nginx 做 TLS 終結和靜態檔案，HAProxy 做 L4/L7 load balancing。

## gRPC 分流跟 canary 部署為什麼要用 L7

[gRPC](chunk://grpc-http2) 只能跑在 HTTP/2 上，一條 TCP 連線裡會有幾十條 stream。L4 只認得連線，不知道裡面有幾條 stream，所以整條都送到同一台 backend，其他機器開著也分不到流量。要按 stream 分散，只能靠 L7。

[Canary 部署](chunk://canary-deploy)是新版上線時先只讓一小部分流量進去，例如 5%，確認沒問題再慢慢加大。要切出這 5%，L7 可以每個 request 單獨決定走哪一版。L4 只能整條連線一起切，比例會跟著連線數跑，做不出精確的百分比。

## 外層放 L4，內層放 L7

情境是一間自架 k8s 的新創。服務從三個長到十五個，內部呼叫陸續改成 gRPC，入口還是一台 nginx 全包。

一台 nginx（L7）全包，在流量小的時候完全沒問題。流量上來之後，第一個動作是入口換成 L4（NLB 或 HAProxy TCP mode），因為外層要的是吞吐和 TLS passthrough，不需要懂內容。再過一陣子，內部 gRPC 呼叫變多，發現長連線讓流量集中在少數 pod 上，才在內層加 L7（Envoy、ALB），把同一條連線上的 stream 分散到不同 pod。最後常見的形態是兩層：外層 L4，內層 L7。

這套兩層架構有兩種情況會讓人後悔。第一種是內層 L7 的成本。每個 request 都要終結、解析、重建連線，CPU 跟 latency 會明顯上升。TLS 在哪一層終結也要重新想，是 L4 passthrough 直接進 pod，還是 L7 終結之後內網改走 mTLS（mutual TLS，兩端都出示憑證）。第二種是兩層的 routing 規則開始重複，甚至互相矛盾，這時候就該收斂到 [service mesh](chunk://service-mesh) 或 Gateway API。

---

接下來的 [packet](article://packet-journey)、[DNS](article://dns-journey)、[routing](article://routing-journey)、[security](article://security-journey) 幾篇，沿著一個封包走的路，看它經過的每台設備拆到第幾層。
