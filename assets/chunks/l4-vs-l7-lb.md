---
title: "L4 vs L7 Load Balancing"
slug: l4-vs-l7-lb
article: lb-l4-l7-lab
brief: "L4 在封包層分流，L7 在請求層分流，看得到多少決定它能做什麼。"
date: 2026-03-09
updated: 2026-07-20
revisions: 3
---

# L4 vs L7 Load Balancing

Load balancer 把流量分散到後端。問題是：它理解多少正在分散的東西？

## L4：封包層

L4 load balancer 操作在 TCP/UDP。它看得到 IP、port、連線狀態。它不讀 payload。

```
Client → [L4 LB 根據 src IP + port 選 backend] → Backend
```

決策發生在每條連線。同一連線的所有封包都去同一個 backend。很快。不解析 header，不暫存 request body。NAT 等級的轉發每秒能處理數百萬連線。

**例子：** AWS NLB、HAProxy TCP mode、Linux IPVS。

## L7：請求層

L7 load balancer 終結連線，讀取應用層協議（HTTP、gRPC）。它看得到 URL、header、cookie、request body。

```
Client → [L7 LB 讀到 /api/users，路由到 user-service] → Backend
```

決策發生在每個 request，不是每條連線。HTTP/2 多工連線上，不同 request 可以去不同 backend。

**例子：** AWS ALB、Nginx、Envoy、HAProxy HTTP mode。

## 同一套軟體，兩種模式

HAProxy 的差異只在 config 一行：`mode tcp` 不看內容，把 TCP 連線輪流分配；`mode http` 讀 URL path，能把 `/first-service` 和 `/second-service` 路由到不同的 backend group。看到多少，決定能做什麼。


## L4 什麼時候撐不住

回想前面的 gRPC/HTTP/2 — 一條 TCP 連線上跑幾十條 stream。L4 balancer 只看到「一條連線」，整條釘到同一個 backend。結果流量都集中到同一台，其他幾台開著也是浪費。這就是 L4 的盲區：它不知道連線裡面裝了什麼。L7 能拆開看個別 stream，才能真正分散。

gRPC 只能跑在 HTTP/2 上，所以 gRPC 服務一定需要 L7 load balancer。L4 也能用，只是會退化成「一條連線釘一台」，失去 load balancing 的意義。AWS 上用 ALB（2020 後支援 gRPC），k8s 上通常是 Envoy（Istio sidecar）。

## Canary 加權：另一個只有 L7 能做的事

Canary 要把「5% 流量導到新版」，也只有 L7 做得到。因為 L7 是逐個 request 處理，能對每個各自決定（例如 5% 機率走新版）；L4 只能整條連線切，做不到。

```yaml
# Istio VirtualService：95% 給穩定版，5% 給新版
http:
  - route:
      - { destination: { host: app, subset: stable }, weight: 95 }
      - { destination: { host: app, subset: canary }, weight: 5 }
```

Gateway API 的 HTTPRoute（`backendRefs` 加 `weight`）、Nginx Ingress 的 `canary-weight` annotation 同理。詳見 [Canary](chunk://canary-deploy)。

## 比較

| 面向 | L4 | L7 |
|---|---|---|
| 看到什麼 | IP、port、TCP flags | URL、header、cookie |
| 決策單位 | 每條連線 | 每個 request |
| TLS | 直接穿透（不終結） | 終結後重新加密 |
| 效能 | 高吞吐、低延遲 | 更多 CPU、更多記憶體 |
| 路由方式 | IP hash、round-robin | Path-based、header-based、weighted |

## 什麼時候用哪個

要原始吞吐、不在意 request 內容 → L4：TCP proxy、資料庫連線、非 HTTP 協議。要根據內容做路由 → L7：API gateway、canary deployment、gRPC balancing。很多架構兩個都用：外層用 L4 快，內層要按內容決定去哪就用 L7。
