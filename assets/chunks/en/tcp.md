---
title: "TCP"
slug: tcp
brief: "Reliable, ordered, congestion controlled. The price: a 1.5 RTT handshake and head-of-line blocking."
article: packet-journey
date: 2026-03-09
updated: 2026-04-08
revisions: 1
---

# TCP

Every byte sent may be lost, duplicated, or arrive out of order. TCP hides that mess, so the layer above can treat the network as reliable.

## How it does it

TCP adds a sequence number, an ACK and a checksum to each IP packet. The sender numbers every byte, the receiver reports what it received, and whatever is missing gets retransmitted.

### Three-way handshake

Setting up a connection takes one and a half RTTs:

```
Client → SYN        → Server
Client ← SYN-ACK    ← Server
Client → ACK + data → Server
```

The client can send data after one RTT, but by the time the data reaches the server, one and a half RTTs have passed. On a transatlantic link with a round trip of about 80ms, the first piece of data takes 120ms to reach the server.

### Congestion control

TCP starts slow. It doubles the send rate every RTT (slow start) until it detects packet loss, then slows down. This keeps a single connection from filling the whole network, but a new connection sends at a low rate for its first few RTTs.

## The cost

**Reliability traded for latency.** One lost packet, and the whole stream stops to wait for the retransmission. That is head-of-line blocking. Send video over TCP and one lost packet freezes the picture, even though the frames behind it arrived long ago.

**Connection setup takes time.** The handshake itself adds latency, and TLS adds another round. HTTP/3 switched to UDP (QUIC) partly to save these round trips.

## When to use it

Where correctness matters more than speed: HTTP APIs, database connections, file transfer. The other way round, where data that arrives late is useless (live streaming, games), or for small queries that finish in one exchange (DNS), UDP fits better.

---

## References

- [Hibernia Express: New York to London submarine cable, round trip under 58.95ms](https://www.submarinenetworks.com/en/systems/trans-atlantic/project-express/hibernia-express-connects-new-york-to-london-in-under-58-95ms)
