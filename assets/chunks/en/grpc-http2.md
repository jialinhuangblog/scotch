---
title: "gRPC on HTTP/2"
slug: grpc-http2
brief: "Multiplexed streams, binary framing. Why gRPC chose it."
date: 2026-03-09
updated: 2026-10-18
revisions: 3
---

# gRPC on HTTP/2

HTTP/1.1 sends one request at a time per connection; six parallel requests means opening six connections. gRPC runs on HTTP/2, which has no such limit.

## HTTP/2: the transport layer

**Multiplexed streams.** One TCP connection carries several requests and responses at the same time, and frames from different streams can be interleaved. There is no more head-of-line blocking at the HTTP layer, though it still exists at the TCP layer.

**Binary framing.** HTTP/1.1 parses text headers every time. HTTP/2 encodes headers into binary frames and compresses them with HPACK. A repeated header (like `Authorization`) is sent once and referenced by index after that.

**Server push.** The server can push resources before the client asks for them. Browsers once used it to push resources ahead of time, but Chrome has had it off by default since version 106 (2022), and the API is hardly used.

## gRPC: the framework layer

gRPC uses HTTP/2 as the transport and Protocol Buffers for serialization.

```protobuf
service OrderService {
  rpc PlaceOrder (OrderRequest) returns (OrderResponse);
  rpc StreamUpdates (OrderId) returns (stream OrderUpdate);
}
```

**Four call patterns:** unary, server streaming, client streaming, bidirectional streaming. Streaming was part of the design from the start, not a workaround added later (REST on HTTP/1.1 needs long-polling, SSE, or WebSocket on the side to stream; gRPC has it built in).

**Code generation.** Write the `.proto` once and any language can generate a typed client and server. No HTTP client to write by hand.

## The cost

**Browsers cannot run native gRPC.** gRPC puts the status code in the trailers, the set of headers that arrives after the response body. Even when the browser's `fetch` runs over HTTP/2 underneath, it does not let JavaScript read trailers or touch the HTTP/2 frames. The upload side can be sent in pieces: since Chromium 105, `fetch` with `duplex: 'half'` over HTTP/2 or later can send the request body while the data is still being produced. The limit is half duplex. Until the request body has been fully sent, the browser does not hand the response to JavaScript. Take a chat room on bidirectional streaming: the client sends its own messages and receives the other side's messages at the same time. In a browser, while the sending stream is still open, not one message comes back. Trailers cannot be read, and upload and download cannot run at the same time, so a browser cannot use gRPC directly.

gRPC-Web is the fallback: it wraps the gRPC payload in a format the browser can handle, with an Envoy proxy in the middle translating back to real gRPC.

```
browser → gRPC-Web (HTTP/1.1) → Envoy proxy → gRPC (HTTP/2) → backend
```

**Hard to debug.** A binary payload cannot be inspected with `curl`. You need a tool such as `grpcurl`.

**An L4 load balancer cannot spread the streams.** An L4 load balancer sees only one TCP connection and has no way to spread the streams inside it. You need L7 (Envoy, Istio) or client-side balancing.

## When to use it

Service to service, where latency and type safety matter → gRPC. Public API, browsers → REST/JSON. The dividing line is roughly the edge (the layer that faces outside, the API gateway / load balancer): gRPC between services inside, REST toward browsers outside.
