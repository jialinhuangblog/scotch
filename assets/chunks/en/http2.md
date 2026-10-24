---
title: "HTTP/2 Stream Multiplexing"
slug: http2
brief: "One TCP connection carries many streams, with frames interleaved. The handshake happens once, but one lost packet at the TCP layer makes every stream wait for the retransmit."
date: 2026-04-28
updated: 2026-07-20
revisions: 2
article: browser-connection-reuse
---

# HTTP/2 Stream Multiplexing

> HTTP/1.1 sends one request at a time per TCP connection, so browsers open up to 6 connections to the same origin. HTTP/2 uses one. How?

## Scenario

A page has 50 resources (CSS, JS, images). Under HTTP/1.1, the browser opens 6 TCP connections and sends in a queue; resource 7 waits until one of them frees up. Every connection does a TCP handshake plus a TLS handshake, and that handshake cost is latency.

```text
HTTP/1.1:
  TCP 1 [conn][TLS][CSS]              [done] [JS]
  TCP 2 [conn][TLS][HTML]      [done][img1]
  TCP 3 ...
  ...
  TCP 6
  resources 7-50 wait in line for a free connection
```

## Stream Multiplexing

HTTP/2 cuts each request into frames and tags each frame with a stream_id. They are sent interleaved on one TCP connection:

```text
[stream=1, HEADERS][stream=3, HEADERS][stream=1, DATA][stream=5, DATA][stream=3, DATA]
```

50 resources = 50 streams, all on the same TCP connection. **The handshake happens once.** CDNs and API gateways use this widely.

## Header Compression (HPACK)

HTTP/1.1 sends a full copy of the headers every time, including cookie / user-agent / authorization. The repetition is large. HPACK keeps a table shared by both ends, and the second time only sends an index:

```text
first time:  Authorization: Bearer abc123...    (200 bytes)
second time: [index 62]                          (1 byte)
```

In API scenarios, repeated headers (Authorization, Cookie) almost all become one index, saving up to ~99% across requests. [Cloudflare's measurements](https://blog.cloudflare.com/hpack-the-silent-killer-feature-of-http-2/) show request headers shrinking by about 76% on average overall (response headers about 69%).


## Connection Coalescing

When different hostnames resolve to the same IP and the cert's SAN (Subject Alternative Name) covers them, the browser merges them into the same TCP connection. Side effect: domain sharding, the HTTP/1.1 era practice of spreading resources across several subdomains, gets merged back into one connection by H2 browsers, and turns into an antipattern.

## The trap: Head-of-Line Blocking at the TCP layer

The application layer is multiplexed, but the transport layer is still TCP. **TCP guarantees order.** If a packet of stream 1 is lost, the packets of streams 2, 3, 4 all wait:

```text
packet 5 of stream 1 is lost
  ↓
TCP receives later packets of streams 2, 3, 4 but does not hand them to the application
  ↓
all 50 streams stall, waiting for the retransmit
```

HTTP/1.1 does not have this problem: its 6 TCP connections are independent, and a lost packet only affects that one.

So **on networks with high packet loss (mobile, weak Wi-Fi), HTTP/2 can be slower than HTTP/1.1**. [HTTP/3 switched to QUIC](chunk://http3-quic) to solve exactly this.
