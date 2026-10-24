---
title: "Server-Sent Events"
slug: sse
brief: "One GET that never closes; the server keeps writing text/event-stream down it. One-way push, native browser auto-reconnect, and it is plain HTTP."
date: 2026-04-28
article: http-realtime-pushing
---

# Server-Sent Events

> The server wants to push data to the client, but does not want to upgrade to WebSocket. Is there a cheaper way?

## The scenario

The typical case is a notification system: the server has new notifications to push to the browser, the data is small, and it flows in one direction only. The client does not need to talk back. WebSocket is two-way, but here only server push is needed, so it brings a pile of features that go unused. Long polling has to send a new request after each response, so every notification costs an extra request round trip.

## Mechanism: an HTTP response that never ends

The client opens a plain GET:

```text
GET /events HTTP/1.1
Accept: text/event-stream
```

The server replies 200 plus a **response body that never finishes**:

```text
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache

data: first message

data: second message

data: third message
... (the connection stays open; the server pushes whenever it wants)
```

Each message starts with `data:`, and messages are separated by a blank line. Thanks to HTTP/1.1 **chunked transfer encoding**, the server does not need to know the size of the whole response in advance.

## Browser API

```ts
const es = new EventSource('/events');
es.onmessage = (e) => console.log(e.data);
es.onerror = () => console.log('reconnecting...');
```

`EventSource` **supports auto-reconnect natively**. When the network drops, the browser reconnects on its own and sends a `Last-Event-ID` header, and the server resumes from where the last push ended.

WebSocket has no such automatic mechanism; you write the retry yourself.

## Connection usage

| | HTTP/1.1 | HTTP/2 |
|---|---|---|
| What SSE takes | 1 of the 6 connections in the per-origin pool | 1 stream on a single TCP connection |
| Several tabs, each with its own SSE | each tab takes 1 connection, less left in the pool | they share the TCP connection, almost no effect on other requests |

Under [HTTP/2](chunk://http2) SSE becomes very cheap, which is one reason SSE has gained users again in recent years.

## SSE vs WebSocket vs Polling

|  | SSE | [WebSocket](chunk://websocket) | Long Polling |
|---|---|---|---|
| Direction | one-way server→client | two-way | one-way (simulated) |
| Protocol | plain HTTP | HTTP handshake, then upgrade | plain HTTP |
| Auto-reconnect | native | write it yourself | resends automatically each round |
| Firewalls / proxies | passes everywhere (it is HTTP) | may be blocked | passes everywhere |
| Server side | write to the response stream | upgrade the protocol + frames | hold the connection |
| Good for | notifications, stock quotes, build logs, LLM streams | chat, games, collaboration | the compatibility fallback when nothing else gets through |

## Where it fits

- **Notification center**: the server pushes, the client does not reply → SSE
- **Stock quotes, live dashboards**: one-way, high volume, plain HTTP so proxies do not block it → SSE
- **OpenAI / Claude API streaming**: the LLM sends tokens back one at a time, and the standard is SSE
- **Build logs, CI status**: the server outputs bit by bit → SSE
