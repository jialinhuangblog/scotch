---
title: "HTTP only lets the client ask. How can the server push data?"
slug: http-realtime-pushing
subtitle: "From the six connections of HTTP/1.1 to WebSocket borrowing an HTTP handshake to upgrade the protocol. Every step works around the same limit: the server cannot send data on its own."
chapter: "realtime"
tags: [http, http2, http3, websocket, sse, polling]
date: 2026-04-28
related: [message-system-axes, webrtc-nat-traversal, why-udp, why-xmpp]
---

# HTTP only lets the client ask. How can the server push data?

HTTP set its tone in 1989: **the client asks, the server answers**. The server cannot speak first. But chat rooms, notification centers, stock tickers and Google Docs collaboration all need "when the server has new data, push it to the client".

For over thirty years engineers have built a whole stack of techniques to get around this limit. Each new layer exists because the layer before it had a gap.

```text
HTTP: one question, one answer
  → Polling: the client keeps asking (wasteful)
    → Long Polling: ask, and the server does not answer right away (hold the connection)
      → SSE: one GET that never closes (one-way stream)
        → WebSocket: borrow the HTTP handshake, then upgrade to two-way TCP
          → Socket.IO as the compatibility fallback (long-poll first, upgrade later)
```

But that is only the "application layer" story. Underneath there is a "transport layer" story. HTTP/1.1 → /2 → /3 was solving a chain of connection and multiplexing problems, and the two chains affect each other.

---

## HTTP/1.1: 6 TCP connections is the ceiling

A browser opens at most **6 TCP connections** to one origin (the Chrome / Firefox default). It does not open 6 at once; it opens them on demand. Each connection uses keep-alive to carry several resources in a row.

```text
resource 1 → open connection 1
resource 2 → connection 1 is busy → open connection 2
resource 3 → connections 1 and 2 are busy → open connection 3
resource 4 → connection 1 just finished → reuse it
resource 7 → nothing idle → wait
```

Each connection carries **one resource at a time**. Resource A has to finish before B can start. This is **head-of-line blocking** (per connection). With 50 resources to load, the first 6 go first and the other 44 queue.

The early workaround was **domain sharding**: spread the resources over 5 subdomains on purpose:

```text
your-site.com  → 6 connections
cdn-a.com      → 6 connections
cdn-b.com      → 6 connections
cdn-c.com      → 6 connections
cdn-d.com      → 6 connections
30 in total
```

The cost is a DNS lookup, a TCP handshake and a TLS handshake for every subdomain. After HTTP/2, sharding became an anti-pattern. The extra handshakes make it slower.

---

## HTTP/2: many streams on one TCP connection

[HTTP/2](chunk://http2) cuts each request into frames and tags each frame with a stream_id. They are interleaved on one TCP connection:

```text
[stream=1, HEADERS][stream=3, HEADERS][stream=1, DATA][stream=5, DATA][stream=3, DATA]
```

50 resources = 50 streams, all on the same TCP connection. **The handshake happens once.** HPACK also compresses repeated headers (Authorization and Cookie are sent as an index the second time).

Tabs share it too: when two tabs connect to the same origin, the browser merges them onto one TCP connection. Connection coalescing goes further and merges across hostnames. If different hostnames are all in the certificate's SAN and DNS resolves them to the same IP, the browser puts them on the same TCP connection as well (RFC 7540 §9.1.1). CDN deployments arrange the certificate and DNS on purpose so this condition holds.

### But underneath it is still one TCP connection: one lost packet stalls every stream (head-of-line blocking)

The application layer is multiplexed, but underneath it is **still one TCP connection**. TCP guarantees order:

```text
packet 5 of stream 1 is lost
  → TCP holds the packets of streams 2, 3, 4 in its buffer too and does not hand them to the application
    → all 200 streams stall, waiting for stream 1 to retransmit
```

HTTP/1.1 does not have this problem. Its 6 TCP connections are independent, and a lost packet stalls only that one. So **on lossy networks (mobile, weak Wi-Fi), HTTP/2 can be slower than HTTP/1.1**.

---

## HTTP/3: push streams down into the transport layer

The problem is that TCP has no concept of streams. A real fix means changing the transport layer.

[HTTP/3](chunk://http3-quic) uses QUIC, a new transport layer that runs on UDP. QUIC re-implements reliable delivery, congestion control and ordering on its own, **but per stream**. Stream 1 loses a packet, streams 2, 3, 4 keep going, and none of them interferes with the others.

Why build on UDP instead of beside TCP? Two reasons. TCP lives in the OS kernel and is hard to change. Middleboxes (NAT, firewalls) only recognize TCP and UDP, and drop the packets of any new protocol. UDP does almost nothing but send the packet out, and leaves everything else to the layer above. Why the kernel is hard to change, and the pseudo code of TCP next to UDP, are in [HTTP/3 over QUIC](chunk://http3-quic).

```text
HTTP/1.1 → several TCP connections, each with its own HOL, a lost packet stalls only that one
HTTP/2   → one TCP connection, multiplexed at the application layer, still HOL at the TCP layer
HTTP/3   → one QUIC over UDP, streams independent at the transport layer
```

QUIC also identifies a connection by a connection ID, so the connection keeps working after the IP changes. **A phone switching from Wi-Fi to 4G does not have to rebuild the connection.**

---

## Application layer: what Polling / SSE / WebSocket solve

The transport layer evolution handles "how N requests share one TCP connection". But HTTP itself was never designed for the server to push.

### Short Polling: just a timer that resends

The client fetches every 5 seconds in a loop:

```ts
setInterval(() => fetch('/messages'), 5000);
```

The server replies right away. With no new data it returns an empty array. The name "short polling" only exists to contrast with long polling. What it does is **the client uses the browser's `setInterval` timer to resend an ordinary HTTP request every few seconds**. Neither the server nor the protocol layer does anything special.

1000 users asking every 5 seconds is 200 requests per second, most of them empty responses. Latency is poor too: in the worst case you wait a full round before seeing new data. Fine at small volume, not at scale.

### Long Polling: the server holds the answer on purpose

The client sends a request, and **the server holds it**, answering only when new data arrives or the timeout hits. The server side code looks like this:

```ts
app.get('/messages', async (req, res) => {
  const msg = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 30_000);
    eventBus.once(`user:${req.userId}:new-message`, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
  res.json(msg ?? { empty: true });
});
```

The server has to remember which requests are waiting. 100,000 users holding at once means 100,000 open TCP connections on the server, which needs non-blocking I/O plus pub/sub to handle. Details in the [long-polling chunk](chunk://long-polling).

Its biggest advantage is that **it is plain HTTP**. Any firewall, proxy or HTTP/1.0 environment works. Socket.IO's fallback is long polling: first make sure a connection works, then upgrade only if upgrading is possible.

### SSE: the response never closes

Long polling disconnects after each answer and reconnects for the next round. SSE's upgrade is that **the connection stays open and the server keeps writing**:

```text
GET /events
  ↓
HTTP/1.1 200 OK
Content-Type: text/event-stream

data: first message

data: second message

data: third message
(a response that never finishes)
```

`Content-Type: text/event-stream` is the SSE format. Under HTTP/1.1 it relies on chunked transfer encoding, so the server does not need to know the full response size in advance. HTTP/2 already sends in frames and needs no chunking. The browser receives with the `EventSource` API:

```ts
const es = new EventSource('/events');
es.onmessage = (e) => console.log(e.data);
```

**SSE has automatic reconnect built in.** When the connection drops, the browser retries on its own and sends a `Last-Event-ID` header, and the server continues from where it last pushed. WebSocket has no such automatic mechanism; you write it yourself. Details in the [SSE chunk](chunk://sse).

### WebSocket: upgrade to two-way

SSE is one-way, and a chat room needs two-way. WebSocket borrows one HTTP handshake and upgrades the TCP connection to a completely different protocol:

```text
GET /chat HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==

HTTP/1.1 101 Switching Protocols

(from here on it is no longer HTTP; WebSocket frames flow both ways)
```

Borrowing the HTTP handshake is for getting through firewalls and proxies (they understand HTTP). Once the upgrade completes, HTTP rules no longer apply. A WebSocket frame header is only 2-14 bytes, far smaller than HTTP headers, which saves bandwidth when messages are frequent. Details in the [WebSocket chunk](chunk://websocket).

---

## Transport layer × application layer: how they interact

| | HTTP/1.1 (pool of 6) | HTTP/2 (1 TCP connection, N streams) |
|---|---|---|
| Short polling | borrows one keep-alive connection per round | one stream, released after the reply |
| Long polling | holds one connection per round | one stream, held |
| SSE | **occupies 1 connection the whole time** | **occupies 1 stream the whole time** |
| WebSocket | **the whole TCP connection is taken** | **RFC 8441 runs WebSocket on one stream** |

Under HTTP/1.1, SSE and WebSocket each take one of the 6 connections in the pool. Open a few tabs, give each one an SSE connection for notifications, and the pool runs out fast. Ordinary API requests have to queue.

Under [HTTP/2](chunk://http2) that pressure disappears. SSE becomes very cheap (one stream), and WebSocket runs on one stream too, through the CONNECT method in RFC 8441. This path is used only when both the server and the browser support it; otherwise the handshake falls back to HTTP/1.1 automatically, with no code to write.

### Which stream number does SSE take

`stream_id` is an integer in the frame header. The client assigns it by counting up as it opens requests. Streams the client opens are always odd (1, 3, 5...), and only server push uses even numbers. SSE has no reserved number. It stands in the same line as images and API calls, and whoever opens first gets the smaller number. The page loads HTML, CSS and JS first, and only once the JS runs does it call `new EventSource()`, so that one might be stream 9.

Once assigned, the number never changes, and closing the stream does not hand the number to anyone else. On a reconnect, `EventSource` sends a brand new request and gets a larger new number, so on the timeline it is 9 → 27, and still only one is alive at a time. To see two numbers at once, the page has to open two `EventSource` objects (one for `/notifications`, one for `/prices`).

---

## Why gRPC requires HTTP/2

[gRPC](chunk://grpc-http2) is tied to HTTP/2 because it needs the features below, and HTTP/1.1 has none of them:

- **Stream**: a bidirectional streaming call needs a two-way stream at the transport level
- **Trailers**: the final status of each call (`grpc-status`) is sent in an HTTP/2 trailing header, and almost nothing supports trailers in HTTP/1.1
- **Header compression (HPACK)**: the metadata of each RPC call repeats a lot
- **Multiplexing**: many calls on one connection

But RPC itself is not tied to HTTP/2. RPC (Remote Procedure Call) is a concept, and it has existed since the 1980s:

| Framework | Transport |
|---|---|
| ONC RPC (1984) | TCP / UDP |
| CORBA | IIOP over TCP |
| Java RMI | JRMP over TCP |
| SOAP / XML-RPC | HTTP/1.0 / 1.1 |
| **gRPC** | **HTTP/2** |
| Cap'n Proto RPC | several transports |

A browser cannot run native gRPC (fetch has no access to HTTP/2 streams, trailers or binary frames), so there is **gRPC-Web**, where a proxy such as Envoy translates it back into real gRPC on the server side.

---

## Choosing in practice

### Notification System

| Need | Suggestion |
|---|---|
| Push notifications to online users | [SSE](chunk://sse). Zero connection cost under HTTP/2, automatic reconnect built in |
| Deliver notifications to offline users | store them in a per-user notification store; the client pulls the unread ones when it comes back online |
| Sync read state across devices | pub/sub + one SSE connection per device |
| Notification volume spikes | Kafka [fan-out](chunk://fan-out) + workers writing per-user queues |

**Receiving while offline or with the page closed:** while the page is open, push directly over your own SSE/WebSocket. Once the page is closed, use **Web Push + Service Worker**:

1. The server POSTs the notification to the **browser vendor's Push Service** (Chrome goes through Google's Firebase Cloud Messaging, Firefox through Mozilla's autopush, Safari through Apple Push Notification service), not to the browser. An HTTP 201 means the Push Service accepted it. The server can go down afterwards and delivery is unaffected.
2. The long-lived connection between "device ↔ Push Service" is maintained by **the browser / operating system** (one shared connection per browser, not one per website). When the device is online the message goes straight down. When it is offline, the message **sits in the Push Service's cloud** (Google / Mozilla / Apple servers, as an encrypted blob the service itself cannot open), **not on the device**. While offline the device has not received it at all, which is why no notification appears; it is delivered once the device reconnects to the Push Service. A message that sits longer than its Time To Live (Firebase Cloud Messaging defaults to about four weeks) is dropped.
3. The browser receives the push → wakes the **normally sleeping Service Worker** → it runs a short piece of code: `showNotification()` for a system notification, write the data into IndexedDB → then it is killed again.

This chain is **best-effort** (messages can be lost and cannot be replayed). The Push Service is a notification queue hosted by the browser vendor, one per device, in the same role as the stack mobile apps use (Apple Push Notification service, Firebase Cloud Messaging).

### Chat System

| Need | Suggestion |
|---|---|
| 1:1 / group realtime messages | [WebSocket](chunk://websocket). Needs two-way |
| Compatibility fallback | [Long polling](chunk://long-polling) fallback (Socket.IO downgrades automatically) |
| Presence (who is online) | a separate pub/sub + heartbeat |
| Typing indicator | straight over WebSocket, never persisted |

### LLM streaming (OpenAI / Claude API)

Purely one-way, high volume, proxy friendly → SSE is the industry standard. The streaming responses of Anthropic and OpenAI both use SSE, not WebSocket.

### Live Dashboard / stock quotes

One-way, low frequency → SSE. Two-way (users can place orders) → split the backend in two: SSE pushes quotes, REST places orders. Simpler than one WebSocket that wraps everything.

---

## A decision scenario

A SaaS company of medium size wants to add a "realtime notification center": when a user is @-mentioned in the system, assigned a task, or receives a comment, a red dot must appear on the web icon right away. The requirements come out like this:

- **One-way**: the server pushes, the client never sends anything back
- **Low volume**: each user gets about 20 notifications a day on average, nowhere near chat frequency
- **Must be simple**: the team has one backend and does not want to maintain a separate WebSocket gateway

Decision: **SSE**. Reasons:
1. The backend can be written on the existing Express server, with no separate gateway
2. The CDN, API gateway and middleware all keep working (SSE is just HTTP)
3. Automatic reconnect is built in, so no code for "what if the connection drops"
4. Zero connection cost under HTTP/2

Six months after launch, the product adds a "collaborative whiteboard" where several users edit at the same time. Only then is it upgraded to WebSocket, with a separately deployed gateway. **The notification center stays on SSE, untouched.**

### When would they regret it

SSE fits server→client one-way traffic. If one day notifications gain a "quick reply button" (for example, replying to a comment right inside the notification), two-way traffic appears. Two paths then:
1. Notifications stay on SSE, and replies go through a separate REST endpoint (the simplest)
2. Switch everything to WebSocket (invest in gateway infrastructure)

If 80% of notifications need no interaction, keep SSE and add REST. Only once the interactive share is high is it worth another round of infra investment to move everything to WebSocket.

---

## The whole chain of causes

```text
HTTP is the client asking and the server answering
  ↓
HTTP/1.1 sends one request at a time per TCP connection
  → work around it with 6 connections, work around it with domain sharding
    ↓
HTTP/2 runs N streams on one TCP connection (solves application HOL)
  → but the TCP layer still has HOL
    ↓
HTTP/3 / QUIC over UDP (solves transport HOL)
  → 0-RTT and connection migration come as a bonus

────(transport layer done)────(the application layer story)────

The server cannot push on its own
  ↓
Polling is wasteful (mostly empty responses)
  ↓
Long Polling saves the empty responses (hold the connection)
  ↓
SSE keeps one connection open, the server keeps writing (one-way)
  ↓
WebSocket upgrades the protocol, two-way (but stateful to manage)
  ↓
Socket.IO as the fallback (long-poll first, upgrade later)
```
