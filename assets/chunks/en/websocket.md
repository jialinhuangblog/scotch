---
title: "WebSocket"
slug: websocket
brief: "HTTP upgraded into a two-way channel. The standard answer for chat, games and collaborative editing."
date: 2026-03-21
updated: 2026-07-20
revisions: 2
article: http-realtime-pushing
---

# WebSocket

> HTTP is the client asking and the server answering. A chat room needs the server to push on its own, and the client to send too. What then?

## The limit of HTTP

```text
HTTP request-response:
  Client: GET /messages → Server: 200 [...]
  (the connection usually closes; next time, send a new request)
```

[Long polling](chunk://long-polling) and [SSE](chunk://sse) solve the "server pushes on its own" half, but both are one way. Chat rooms, games and collaborative editing need **two way**.

## WebSocket: the upgrade protocol

The client starts with one HTTP request carrying an `Upgrade: websocket` header. The server replies `101 Switching Protocols`, and **from then on this TCP connection is no longer HTTP**:

```text
GET /chat HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==

HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=

(everything after this is WebSocket frames, sent either way at any time)
```

Borrowing the HTTP handshake is for **getting through firewalls and proxies**. They recognize HTTP, but not a connection that is something other than HTTP from the first byte. Once the upgrade completes, HTTP rules no longer apply.

## Two-way frames

```text
B → {"type":"msg", "text":"hello"}
B ← {"type":"msg", "from":"A", "text":"hi"}
B ← {"type":"typing", "from":"C"}
B → {"type":"msg", "text":"ok"}
```

A WebSocket frame header is only 2-14 bytes, far smaller than an HTTP header. **High-frequency messaging saves bandwidth.**

> The range runs from 2 to 14 because the length field uses [variable-length encoding](chunk://varint-encoding) (7 bits for ≤125, 2 more bytes for ≤64KB, 8 more bytes beyond that), plus 4 extra bytes of masking key when the client sends, to stop proxy cache poisoning. The common short message has the least overhead.

Under [HTTP/2](chunk://http2), WebSocket uses the CONNECT method over a single stream (RFC 8441) and no longer holds the whole TCP connection. This path is used only when both server and browser support it; otherwise it falls back to HTTP/1.1 automatically.

## The cost

**Stateful connection.** Each WebSocket is bound to one server. When the server restarts, scales out or deploys, the connection drops and the client has to reconnect. The load balancer has to support sticky sessions (the same client is always routed to the same server), or be an L7 load balancer that understands WebSocket.

**The HTTP toolchain does not apply.** CDNs, caches, API gateways and middleware are mostly built on the HTTP request/response model. WebSocket is not request/response, so they cannot be used as is.

**Connection count cost.** 100,000 WebSockets = 100,000 TCP connections held in memory. Each is a few KB, but the OS file descriptor limit has to be raised.

**No built-in reconnect.** The EventSource of [SSE](chunk://sse) reconnects automatically; with WebSocket you write the retry and the state restore yourself.

## How to choose

|  | Scenario |
|---|---|
| [Short polling](chunk://long-polling) | Low volume, the simplest compatible approach |
| [Long polling](chunk://long-polling) | Strict proxies, nothing else gets through |
| [SSE](chunk://sse) | One way server→client (notifications, streamed logs, LLM tokens) |
| **WebSocket** | Two way (chat, games, collaboration, whiteboard) |

## Architecture in practice

100,000 WebSockets should not be managed by the application server directly. The common approach is to add a WebSocket Gateway layer in between:

```text
Client ↔ WebSocket Gateway ↔ Message Broker (Kafka / Redis Pub-Sub) ↔ App Server
```

The Gateway only handles connections and forwarding; business logic lives in the App Server. **The App Server stays stateless and can scale freely.** This way, the stateful trouble of "a connection must be bound to one fixed machine" stays in the Gateway layer and does not spread to the App Servers behind it.
