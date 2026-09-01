---
title: "同一套 HAProxy，改一行 config 就從 L4 變 L7"
slug: lb-l4-l7-lab
subtitle: "mode tcp 只會把連線輪流分出去，mode http 讀得到 URL。gRPC 分流和 canary 加權，都只有讀得到的那邊做得到。"
chapter: "networking"
tags: [load-balancer, haproxy, nginx, l4, l7, grpc, canary]
date: 2026-07-20
related: [network-devices-by-layer]
---

# 同一套 HAProxy，改一行 config 就從 L4 變 L7

[前篇](article://network-devices-by-layer)的結論是：拆封包拆到第幾層，決定它是什麼設備。這個判準最好的活例子是 load balancer。L4 和 L7 的差別不是兩種硬體、也不是兩套軟體，同一套 HAProxy 改一行 config 就能切換。這篇直接在自己電腦上跑一次，看「多拆一層」到底多出什麼能力。

## 看到多少，決定能做什麼

[L4 load balancer](chunk://l4-vs-l7-lb) 操作在 [TCP](chunk://tcp)/UDP，看得到 IP、port、連線狀態，不讀 payload。決策以「連線」為單位：同一條連線的所有封包去同一個 backend。不解析 header、不暫存 body，NAT 等級的轉發每秒能處理數百萬連線。AWS NLB、HAProxy TCP mode、Linux IPVS 都是。

L7 load balancer 終結連線，讀應用層協議。看得到 URL、header、cookie，決策以「request」為單位：同一條 HTTP/2 連線上的不同 request 可以去不同 backend。AWS ALB、Nginx、Envoy、HAProxy HTTP mode。

理論到這裡，接下來實際跑一次。

## 實測 L4：mode tcp

兩個 Express server 跑同一份 code，不同 port：

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

`mode tcp`。HAProxy 不看 HTTP 內容，只把 TCP 連線輪流分配。curl 多次，交替看到不同 server 回應：

```bash
$ curl localhost
<h1>listening at port 1234</h1>
$ curl localhost
<h1>listening at port 5678</h1>
$ curl localhost
<h1>listening at port 1234</h1>
```

它做的事跟 switch 轉發 frame 一樣單純：不問內容，照規則分出去。

## 實測 L7：mode http

這次是兩個不同的 service，各起兩個 instance：

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

`mode http`。HAProxy 讀 URL path，根據 `/first-service` 或 `/second-service` 路由到不同的 backend group。每個 group 內部再 round-robin：

```bash
$ curl localhost:9999/first-service
<h1>First service at 1111</h1>
$ curl localhost:9999/first-service
<h1>First service at 2222</h1>
$ curl localhost:9999/second-service
<h1>Second service at 3333</h1>
```

同一套 HAProxy，差異只有 `mode tcp` vs `mode http`。TCP mode 只轉封包，HTTP mode 能讀 URL 做路由。多拆開一層 HTTP header，「按路徑分服務」這種規則才寫得出來。

實務上不需要分兩個 config。一個 `haproxy.cfg` 裡同時定義 TCP 和 HTTP frontend，各綁不同 port，同一個 process 同時處理兩種模式。

## HAProxy vs Nginx

兩個都處理流量，但定位不同：

| | HAProxy | Nginx |
|---|---|---|
| 定位 | 專職 load balancer | Web server + reverse proxy |
| L4 TCP | 強項 | 能做，但非主力 |
| L7 HTTP | 能做 | 強項 |
| 靜態檔案 | 不行 | 能直接 serve HTML/CSS/JS |
| Health check | 內建，細緻 | 基本的 |

Nginx 是「web server 兼 [reverse proxy](chunk://reverse-proxy)」，能 serve 靜態網站也能反向代理。HAProxy 是「專職 load balancer」，不 serve 任何內容，只負責分配流量。很多架構兩個一起用：Nginx 做 TLS 終結和靜態檔案，HAProxy 做 L4/L7 load balancing。

## 為什麼差這一層很重要：gRPC 和 canary

[gRPC](chunk://grpc-http2) 只能跑在 HTTP/2 上，一條 TCP 連線裡塞幾十條 stream。L4 只看到「一條連線」，整條釘到同一台 backend，其他機器開著也分不到流量。要把連線拆開、按 stream 分散，只有 L7 做得到。

[Canary](chunk://canary-deploy) 的「5% 流量走新版」同理。L7 逐 request 決策，可以對每個 request 各自決定走哪版；L4 只能整條連線切，做不出百分比。

## 決策視角：外層放什麼、內層放什麼

情境：自架 k8s 的新創，服務從三個長到十五個，內部呼叫陸續改 gRPC，入口還是一台 nginx 全包。

決策路徑通常這樣走。一台 nginx（L7）全包，在流量小的時候完全沒問題。流量上來之後，第一個動作是入口換成 L4（NLB 或 HAProxy TCP mode），因為外層要的是吞吐和 TLS passthrough，不需要懂內容。再過一陣子，內部 gRPC 呼叫變多，發現長連線讓流量集中在少數 pod 上，才在內層加 L7（Envoy、ALB），把 stream 拆開分。最後常見的形態是兩層：外層 L4，內層 L7。

Regret signal 有兩個。一是內層 L7 的成本：每個 request 都要終結、解析、重建連線，CPU 和 latency 有感上升，TLS 在哪層終結也要重新想（L4 passthrough 進 pod，還是 L7 終結後內網走 mTLS）。二是兩層各自的 routing 規則開始重複甚至矛盾，這是該收斂到 [service mesh](chunk://service-mesh) 或 Gateway API 的訊號。

---

前篇給了判準，這篇跑了一次。chain 後面的旅程系列（packet、DNS、routing、security）都是同一個問題的展開：封包走到哪一站、那一站拆它到第幾層。
