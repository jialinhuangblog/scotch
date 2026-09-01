---
title: "gRPC on HTTP2"
slug: grpc-http2
brief: "多工串流、二進位 framing。gRPC 選它的原因。"
date: 2026-03-09
updated: 2026-07-20
revisions: 1
---

# gRPC on HTTP2

HTTP/1.1 一條連線一次只送一個 request。想要六個平行請求？開六條連線。gRPC 站在 HTTP/2 上面，把這個瓶頸消除了。

## HTTP/2：傳輸層

**多工串流。** 一條 TCP 連線同時跑多個 request 和 response。HTTP 層不再有 head-of-line blocking。不同 stream 的 frame 自由交錯。

**二進位幀。** HTTP/1.1 每次都解析文字 header。HTTP/2 把 header 編成二進位 frame，用 HPACK 壓縮。重複的 header（像 `Authorization`）送一次就好，之後用 index 參照。

**Server push。** Server 能在 client 開口前主動推資源。瀏覽器有用，API 幾乎不用。

## gRPC：框架層

gRPC 拿 HTTP/2 當傳輸，Protocol Buffers 當序列化。

```protobuf
service OrderService {
  rpc PlaceOrder (OrderRequest) returns (OrderResponse);
  rpc StreamUpdates (OrderId) returns (stream OrderUpdate);
}
```

**四種呼叫模式：** unary、server streaming、client streaming、bidirectional streaming。streaming 本來就是設計的一部分，不是事後補的 workaround（REST 在 HTTP/1.1 上得用 long-polling、SSE 或 WebSocket 硬湊 streaming，gRPC 直接內建）。

**程式碼生成。** 寫一次 `.proto`，任何語言都能產出 typed client 和 server。不用手寫 HTTP client。

## 代價

**瀏覽器跑不了原生 gRPC。** 瀏覽器的 `fetch` 只有 HTTP/1.1 語意，拿不到 HTTP/2 的 stream、trailer、binary frame。gRPC 重度依賴這些（trailer 帶 status code、binary frame 帶 protobuf payload），所以瀏覽器裡跑不了。

gRPC-Web 是降級方案：把 gRPC payload 包成瀏覽器能處理的格式，中間放一個 Envoy proxy 翻譯回真正的 gRPC。

```
瀏覽器 → gRPC-Web (HTTP/1.1) → Envoy proxy → gRPC (HTTP/2) → backend
```

**難 debug。** Binary payload 不能用 `curl` 看。要用 `grpcurl` 之類的工具。

**Load balancer 要注意。** L4 load balancer 只看到一條 TCP 連線，無法分散 stream。需要 L7（Envoy、Istio）或 client-side balancing。

## 什麼時候用

Service-to-service、在意延遲和型別安全 → gRPC。Public API、瀏覽器 → REST/JSON。大概就以 edge 為界（系統對外的那層，API gateway / load balancer），裡面服務之間用 gRPC、外面對瀏覽器用 REST。
