---
title: "How the browser decides how many connections to open or merge"
slug: browser-connection-reuse
subtitle: "At most six connections to one domain, HTTP/2 merges them into one, coalescing pulls other domains into that one too, HTTP/3 keeps the connection alive across a network change. The browser sets every rule, and it decides how the page loads."
chapter: "buffer"
tags: [connection-pooling, http2, http3, coalescing, san, cdn, performance]
date: 2026-07-20
related: [resource-pool-pattern, db-connections]
---

# How the browser decides how many connections to open or merge

[The pool article](article://resource-pool-pattern) covered what makes a resource worth pooling: expensive to create and reusable, so keep it instead of throwing it away. [The DB connections article](article://db-connections) covered how the server side manages them. The pool you use most every day is actually in the browser. It runs every time a page opens, and there is no API to configure it. Its rules went from six connections per origin to one, and later even other domains got merged into that one.

## Where the cost is: one connection

Opening one HTTPS connection costs one RTT for the [TCP](chunk://tcp) handshake and one or two more for [TLS](chunk://tls). On mobile networks the RTT is often 50~100ms, so a connection spends one or two hundred milliseconds before it sends a single byte. If a page has 50 resources and each one reconnects, that cost multiplies directly.

Connections are expensive and reusable, so browsers have had a built-in pool since HTTP/1.1 keep-alive. What changed later is how many connections open per origin, and how many requests one connection serves at the same time.

## HTTP/1.1: pool size fixed at 6

One HTTP/1.1 connection runs only one request at a time; the next can be sent only after the response comes back. 50 resources on one connection means a queue. The browser's answer is to open 6 connections to the same origin, six windows serving at once, and the seventh resource still waits.

The number 6 is fixed inside the browser; a site cannot change it. The workaround back then was domain sharding: spread resources across `static1.example.com` and `static2.example.com` to make the browser believe "these are different origins" and open more sets of six. The cost is that every shard pays for another DNS lookup and handshake.

## HTTP/2: pool size = 1

[HTTP/2](chunk://http2) cuts each request into frames, tags them with a stream id, and interleaves them on one connection. 50 resources = 50 streams, all on the same TCP, one handshake. The pool goes from "6 connections, one request each" to "1 connection for everything".

So domain sharding went from optimization to antipattern. Every extra shard costs another DNS lookup and handshake, and the parallelism it buys HTTP/2 already has inside one connection.

## Coalescing: other domains get merged in too

HTTP/2 browsers go one step further. If different hostnames are **covered by the certificate's SAN (Subject Alternative Name) and DNS resolves them to the same IP**, the browser merges them onto the same TCP connection. A request for the new hostname opens a stream on the existing connection and uses the `:authority` pseudo-header (the field that replaces the Host header in HTTP/2) to say which hostname it is for:

> **What is a SAN?** A field on a TLS cert listing "which hostnames this certificate is valid for". Before issuing a cert, the CA has to run **DCV (Domain Control Validation)** on every hostname in the SAN: an HTTP, DNS or TLS challenge, one of the three, proving the applicant controls that domain. Only then is the cert issued, so nobody can sneak someone else's domain into a SAN. A CDN can put hundreds of customer domains into one cert because **the customers point their DNS NS at the CDN**, which amounts to authorizing the CDN to validate on their behalf. Further: every cert must be registered in a [Certificate Transparency log](https://crt.sh), and browsers reject a cert that is not in CT, so anyone issuing certs improperly gets found out. Since 2017 Chrome ignores the cert's CN field entirely and **looks only at the SAN**.

```text
open: browser ↔ 1.2.3.4 (cert SAN: example.com, *.example.com, cdn.othersite.com)

fetch https://images.example.com/x → same IP + covered by SAN → reuse
fetch https://cdn.othersite.com/y  → same IP + listed explicitly in SAN → reuse
```

CDNs use this mechanism too. Cloudflare's early Universal SSL put **several customers' domains into the SAN of one cert**. Customer A's `a.com` and customer B's `b.com` resolve to the same edge IP, so when one page loads both, the browser can put both sides' requests on **the same connection**.

The side effect is that domain sharding gets cancelled automatically. Spread resources across `static1` and `static2` to open more connections, and if they resolve to the same IP with the same cert, the browser coalesces them back into one. The sharding effort is wasted. Keeping sharding alive means resolving the subdomains to different IPs or issuing different certs, but after H2 there is no reason to keep it anyway.

Further: the [ORIGIN frame (RFC 8336)](https://datatracker.ietf.org/doc/html/rfc8336) lets the server announce "this connection can also serve a.com and b.com", so the client does not redo the DNS + cert check for every hostname and coalesces more aggressively. Cloudflare sends it; browser support is modest.

## HTTP/3: a pooled connection survives a network change

A TCP connection is bound to (src_ip, src_port, dst_ip, dst_port). A phone switching from Wi-Fi to 4G changes its IP, the connection is void, and the whole pool is rebuilt. QUIC in [HTTP/3](chunk://http3-quic) identifies a connection by connection ID, so it keeps working after the IP changes. For the pool, this removes the biggest source of "resource invalidated".

0-RTT reconnect is the same pool idea: for a server visited before, keep the last session's information, and on reconnect send the handshake together with the first request. Even after the pool is emptied, rebuilding it costs close to nothing.

## Compared with the DB pool

| | DB connection pool | Browser connection pool |
|---|---|---|
| Who sets the pool size | you (max size, PgBouncer mode) | fixed in the browser (6 per origin, 1 under H2) |
| Requests one connection serves at once | in transaction mode, several clients take turns | H2 interleaves dozens of streams |
| Handling invalidation | health check, evict stale ones | H3 connection ID survives a network change |
| What you can do | tune parameters | work with the rules (fewer domains, preconnect) |

PgBouncer's transaction mode and HTTP/2 multiplexing have the same shape: pack many logical users into a few physical connections, and raise utilization by "cut into small units and take turns". The difference is that on the DB side you choose the mode yourself, and the session state problems are yours to handle. On the browser side the whole logic is built in, and sharding you add yourself gets coalesced back.

## Decision perspective: what is left to do for frontend performance

Situation: an old e-commerce frontend, carefully optimized in the HTTP/1.1 era: domain sharding, CSS sprites, inlined small images. It now sits behind a CDN and has been upgraded to HTTP/2.

Decision path: the first step is to dig out the old optimizations and review each one again, because their premises no longer hold under H2. Sharding ends in one of two ways, and both are bad: the subdomains resolve to the same CDN edge and get coalesced back into one connection, so a pile of DNS settings was kept for nothing; or they resolve to different IPs, and every shard really does pay one more handshake, which buys nothing because H2 already has parallelism inside one connection. Merging back to a single domain is the right answer. Same for sprites and inlining: under H2, 50 small requests cost about the same as one large one, and switching back to separate small files lets each be cached on its own. Only the second step adds anything new: `preconnect` for third parties that really cannot be merged (payments, analytics), so the handshake happens early; and turning on HTTP/3 at the CDN, where mobile users gain the most.

Two things cause regret. The first is adding too many `preconnect` hints. Each one really opens a connection, taking bandwidth and resources, so keep them for a few critical domains only. The second is changing things without looking at the data. Whether coalescing actually happened shows in the connection ID column in DevTools, not in the settings.
