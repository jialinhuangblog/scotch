---
title: "L4 vs L7 Load Balancing"
slug: l4-vs-l7-lb
article: lb-l4-l7-lab
brief: "L4 只看 IP 跟 port，同一條連線整條送到同一台 backend；L7 讀得到 URL 跟 header，每個 request 能各自分到不同 backend。"
date: 2026-03-09
updated: 2026-07-20
revisions: 3
---

# L4 vs L7 Load Balancing

Load balancer 把流量分散到後端。那它讀得懂多少自己正在分的流量呢？

## L4：封包層

L4 load balancer 工作在 TCP/UDP，讀得到 IP、port、連線狀態，但不讀 payload。

```
Client → [L4 LB 根據 src IP + port 選 backend] → Backend
```

L4 以連線為單位做決定，同一條連線的所有封包都去同一個 backend。因為不解析 header、也不暫存 request body，速度很快，NAT 等級的轉發每秒能處理數百萬條連線。

**例子：** AWS NLB、HAProxy TCP mode、Linux IPVS。

## L7：請求層

L7 load balancer 終結連線，讀取應用層協議（HTTP、gRPC），所以讀得到 URL、header、cookie、request body。

```
Client → [L7 LB 讀到 /api/users，路由到 user-service] → Backend
```

決策發生在每個 request，不是每條連線。HTTP/2 多工連線上，不同 request 可以去不同 backend。

**例子：** AWS ALB、Nginx、Envoy、HAProxy HTTP mode。

## 同一套軟體，兩種模式

HAProxy 的差異只在 config 一行：`mode tcp` 不看內容，把 TCP 連線輪流分配；`mode http` 讀 URL path，能把 `/first-service` 和 `/second-service` 路由到不同的 backend group。

## L4 什麼時候不夠用

gRPC 跑在 HTTP/2 上，一條 TCP 連線裡跑幾十條 stream。L4 balancer 只看到一條連線，整條都送到同一個 backend，結果流量集中到同一台，其他幾台開著也是浪費。L4 不解析連線內容，不知道裡面有幾條 stream。L7 會解析出個別 stream，才能把它們分到不同 backend。

gRPC 只能跑在 HTTP/2 上，所以 gRPC 服務要真正做到 load balancing，就需要 L7 load balancer。L4 也能用，只是同一條連線上的所有 request 都會送到同一台，流量沒有分散開。AWS 上用 ALB（2020 後支援 gRPC），k8s 上通常是 Envoy（Istio sidecar）。

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
| TLS | 通常直接穿透（也可以在 LB 終結） | 終結，要加密到後端就再重新加密 |
| 效能 | 高吞吐、低延遲 | 更多 CPU、更多記憶體 |
| 路由方式 | IP hash、round-robin | Path-based、header-based、weighted |

## 什麼時候用哪個

要原始吞吐、不在意 request 內容 → L4：TCP proxy、資料庫連線、非 HTTP 協議。要根據內容做路由 → L7：API gateway、canary deployment、gRPC balancing。很多架構兩個都用：外層用 L4 快，內層要按內容決定去哪就用 L7。
