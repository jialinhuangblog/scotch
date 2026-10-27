---
title: "Long Polling"
slug: long-polling
brief: "The client sends one request and the server holds it until there is data. The earliest way to imitate push, and the most compatible."
date: 2026-04-28
article: http-realtime-pushing
---

# Long Polling

> HTTP is request-response; the server cannot push on its own. Before SSE and WebSocket existed, how did engineers do real time?

## Short Polling (baseline)

The client sends a request every few seconds in a loop:

```ts
setInterval(() => fetch('/messages?since=100'), 5000);
```

The server replies right away, with an empty array if there is nothing new.

```text
00:00 → GET /messages → 200 []
00:05 → GET /messages → 200 []
00:10 → GET /messages → 200 [{id: 101}]
```

**The problem**: 1000 users asking every 5 seconds means the server handles 200 requests per second, most of them empty replies. Latency is bad too: in the worst case a new message waits a full round before it shows up.

## Long Polling

The client sends a request the same way, but **the server deliberately does not reply right away**:

```text
Client: GET /messages?since=100
Server: hold... hold... hold...
        (A sends a message)
Server: 200 [{id: 101}]
Client: GET /messages?since=101
Server: hold...
```

The server has to build the **waiting mechanism** itself:

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

The server keeps state for "requests currently waiting" and replies only when an internal event fires or the timeout runs out.

## The cost

| Dimension | Effect |
|---|---|
| Connections stay open | 100k users holding at once = 100k TCP connections open on the server |
| Reconnect overhead | Every reply means a new request, and under HTTP/1.1 another round of headers |
| Server code | Needs non-blocking I/O + pub/sub to handle this volume |
| Short gaps | During the few hundred ms of timeout / reconnect, no message gets through |

## Why people still use it

[SSE](chunk://sse) and [WebSocket](chunk://websocket) are both more efficient than long polling, but long polling **is plain HTTP**:

- Passes through any firewall / proxy / load balancer
- Needs no HTTP/1.1 chunked transfer, no Upgrade header
- Works on HTTP/1.0 too (though every round reconnects TCP)
- Any HTTP framework on the backend can write it, even without a stream API

**Socket.IO's fallback is long polling**: it connects with long polling first to make sure the connection works, then upgrades to WebSocket only if it can. On corporate intranets and behind strict proxies, long polling is the last option that still works.
