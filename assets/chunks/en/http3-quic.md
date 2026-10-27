---
title: "HTTP/3 over QUIC"
slug: http3-quic
brief: "The transport layer knows about streams too, so a lost packet stalls only that one stream. Built on UDP to get around TCP's HOL blocking."
date: 2026-04-28
updated: 2026-08-08
revisions: 4
article: why-udp
---

# HTTP/3 over QUIC

> HTTP/2 multiplexes at the application layer, but the TCP layer still delivers the whole connection in order. One lost packet stalls every stream. How do you fix this at the root?

HTTP/3 still retransmits lost packets, but only the stream that lost one has to wait. The other streams are handed to the application as usual.

## Motivation

[HTTP/2's HOL blocking](chunk://http2): 50 streams share one TCP connection. Stream 1 loses one packet, and TCP holds the later packets in its buffer instead of handing them to the application, so the application sees all 50 streams stalled.

The problem is TCP. TCP only knows a byte stream; it has no idea streams exist. Fixing it at the root means replacing the transport layer.

## QUIC: a transport layer on UDP

```text
HTTP/3
  ↓
QUIC (transport layer, stream aware, encryption built in)
  ↓
UDP (a thin layer; the kernel just delivers datagrams and leaves the rest to QUIC)
```

QUIC reimplements what TCP does, reliable delivery, congestion control, ordering, **but per stream**:

```text
packet 5 of stream 1 is lost
  ↓
QUIC: only the later data of stream 1 waits for the retransmit, streams 2, 3, 4 keep going to the application
  ↓
the other 49 streams are unaffected
```


## Why build on UDP

First, TCP's behavior lives entirely in the OS kernel, so changing it means waiting for every OS to upgrade. QUIC moves retransmission, congestion control, and TLS into a user space library, so a browser update is enough to change it. Second, the NATs and firewalls in the middle only recognize TCP and UDP; a new protocol number gets dropped outright (SCTP, Stream Control Transmission Protocol, another transport protocol, never spread across the internet for exactly this reason), so going through UDP is the safest route. The cost is higher CPU in user space. When an old network blocks UDP, the browser falls back to TCP H2 automatically.

## 0-RTT connections

TCP + TLS 1.3 needs two round trips before the first request can be sent. QUIC sits on UDP, so connection setup and the TLS handshake happen in the same round trip.

```text
TCP + TLS 1.3 (first connection)
  → SYN
  ← SYN-ACK                        1 RTT: both sides confirmed reachable
  → ClientHello
  ← ServerHello + cert + Finished  2 RTT: keys exchanged
  → Finished + GET /
  ← response                       3 RTT: data received

QUIC (first connection)
  → Initial (with ClientHello)
  ← ServerHello + Finished         1 RTT: connection and keys ready together
  → GET /
  ← response                       2 RTT: data received

QUIC (reconnecting to the same server)
  → Initial + GET / (encrypted with the key kept from last time)
  ← response                       1 RTT: the request does not wait for the handshake, this is 0-RTT
```

For mobile networks and connections across regions where latency is high, **0-RTT cuts out a delay large enough to notice**.

## Connection Migration

A TCP connection is bound to (src_ip, src_port, dst_ip, dst_port). When a phone switches from Wi-Fi to 4G, the IP changes and TCP has to reconnect.

QUIC identifies a connection by connection ID, so it keeps working after the IP changes. That is why a YouTube video does not stop when you switch from Wi-Fi to 4G partway through.

## Adoption

- **Google, Cloudflare, and Facebook all run HTTP/3**; most YouTube traffic is QUIC
- All browsers support it
- Inside a corporate network or data center, latency is low and packet loss is rare, so **HTTP/2 is enough**
- HTTP/3's benefit is mainly on the last mile where packets get lost (phones, home networks)
