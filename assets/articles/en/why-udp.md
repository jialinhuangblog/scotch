---
title: "TCP has problems, but nobody fixes TCP: why QUIC and WebRTC both chose UDP"
slug: why-udp
subtitle: "Fixing TCP means waiting for the whole world to replace its kernel, and a new protocol gets dropped by forty years of middleboxes. So QUIC and WebRTC both wrap their own protocol inside UDP."
chapter: "networking"
tags: [quic, http3, udp, tcp, webrtc, sctp, ossification]
date: 2026-07-20
updated: 2026-10-17
revisions: 1
related: [http-realtime-pushing, webrtc-nat-traversal]
---

# TCP has problems, but nobody fixes TCP: why QUIC and WebRTC both chose UDP

The previous two articles each left one detail unexplored: [the realtime push article](article://http-realtime-pushing) mentioned that HTTP/3 replaced TCP, and in [the WebRTC article](article://webrtc-nat-traversal) the video stream ran on UDP from day one. Two unrelated technologies, one solving head-of-line blocking and one solving video latency, both ended up on the same layer: UDP, finalized in 1980.

TCP's problems are well known. The normal instinct is to fix TCP, or to invent a better transport layer. Both roads have been walked, and neither could be deployed across the whole internet. So QUIC chose UDP.

## Where TCP goes wrong

[HTTP/2](chunk://http2) runs dozens of streams on one TCP connection, but [TCP](chunk://tcp) does not know streams exist. It knows one ordered byte stream. When any packet is lost, every byte after it waits for the retransmission, so one stream's trouble makes every stream wait. This is head-of-line blocking at the transport layer, and no detour at the application layer gets around it.

A real fix needs a transport layer that "knows streams", where a lost packet affects only the stream it belongs to. Designing such a protocol is not hard. SCTP (Stream Control Transmission Protocol) was designed back in 2000. The hard part is deployment: every OS and every network device in the world has to support it.

## Road one: fix TCP. Fix it where?

TCP is not a library. It is part of the OS kernel. Put it next to UDP and the gap is obvious:

```
# UDP in the kernel: wrap a header, send it, forget it
udp_send(data, dst):
    pkt = UDP_header(src_port, dst_port, len, checksum) + data
    hand to the IP layer. Done.        # keeps no state (the UDP send path in Linux is a few hundred lines)

# TCP in the kernel: a pile of state per connection, always running in the background
tcp_send(data):
    for seg in split(data, MSS):       # 1. segment
        seg.seq = next_seq             # 2. number
        unacked.add(seg)               # 3. cannot drop until ACKed
        if cwnd allows: send(seg)      # 4. congestion control decides how much to send at once
on_ack(ack):      unacked.remove(<=ack); grow cwnd        # ACK received → clear + speed up
on_timeout(seg):  send(seg); cwnd = 1 segment             # no ACK → retransmit + ramp up slowly from the start
on_recv(seg):     if out of order: hold it until the gap fills; else hand to the app in order   # reassembly
# plus handshake, SACK, Nagle, flow control... all in this layer (tens of thousands of lines of C in Linux)
```

Changing any TCP behavior means changing the kernel. And after the change? Wait for Linux to merge → wait for distributions to package → wait for servers to upgrade their kernel → wait for Windows, macOS, iOS and Android to follow one by one. One change takes five years to spread across the whole internet.

QUIC moves retransmission, congestion control, streams and TLS into a user space library: Chrome has `quiche`, Cloudflare has its own `quiche`, Microsoft has `msquic`, Meta has `mvfst`. Each ships new versions independently. When Google wants to try a new congestion control, it takes effect with the next Chrome update, without waiting for any OS.

## Road two: invent a new transport layer. SCTP tried

SCTP came out of the telecom industry, designed around 2000 to carry signaling for telephone networks. On paper it is "TCP, fixed": multi-stream built in, independent retransmission per stream, no head-of-line blocking. There is nothing to fault in the design.

The result: it is used only inside telecom networks and datacenters, and on the public internet it does not work. A packet does not pass through only the two ends. In between sit NATs, firewalls and all kinds of ISP equipment. For forty years these devices have been used to seeing TCP (protocol number 6) and UDP (17). When they see SCTP's 132 they cannot classify it, and the safest handling is to drop it. Both ends supporting SCTP is useless: if any one device in the middle drops the SCTP packets, the connection never comes up.

This is called **protocol ossification**. The middleboxes' assumptions about "what the network looks like" are fixed in firmware, and over time the whole network only recognizes the protocols that already exist. TCP itself is affected: the TCP header is plaintext, middleboxes have assumptions even about TCP options, and a newly added option often gets stripped.

## The road left: go through UDP

In the kernel, UDP only adds the port information and sends. It keeps no state. It offers no reliable delivery, but QUIC was going to do its own reliable delivery anyway. UDP only has to be the exit that "hands the packet to the network card".

And the middleboxes let UDP through. DNS, VoIP and online games have run on UDP for decades. Every NAT and firewall in the world recognizes it, and at most does port translation. QUIC wraps its packets inside UDP, and these devices let them pass.

QUIC learned from SCTP's failure and added one more layer of defense: encryption with TLS 1.3 from the handshake on. The transport layer information TCP puts in its plaintext header, the ACKs, the window size, QUIC puts inside the encrypted payload. What stays in plaintext is a few fields like the connection ID, and even the packet number gets an extra layer of header protection. Middleboxes cannot see the content, so they cannot form assumptions about it, and there will be no "QUIC ossification" in the future.

## WebRTC reached the same conclusion earlier

WebRTC's first reason for UDP differs from QUIC's. Realtime video would rather drop a frame than stop and wait for a retransmission; by the time the frame arrives it is stale. TCP's reliable delivery is a drawback in this scenario, so the media stream runs RTP (Real-time Transport Protocol) over UDP, and a lost packet stays lost.

WebRTC can be deployed on the public internet thanks to UDP as well. NAT hole punching (the [STUN/TURN](chunk://stun-turn) flow) succeeds far more often over UDP. In the tests cited by RFC 5128, UDP works on over 80% of NATs, TCP on just over 60%.

WebRTC's DataChannel (the channel for data, not the media stream) carries SCTP, wrapped in DTLS (Datagram TLS), running on UDP. SCTP straight on IP cannot get past the middleboxes of the public internet. Wrapped in UDP, it can be deployed on the public internet.

## The cost

- QUIC runs in user space, so CPU is higher than kernel TCP: no zero-copy, more syscalls. Recent years recovered much of it: io_uring lets syscalls be submitted in batches, sendmmsg sends several packets in one syscall, and GSO (Generic Segmentation Offload) hands a large packet to the network card or the kernel to split later.
- A few networks rate limit UDP or block it outright. When the browser meets one it falls back to HTTP/2 over TCP automatically, and the user never notices.
- Stateful firewalls remember UDP connection state for a shorter time, so keep-alives are needed.

On the last mile, phones and home networks, loss is high and network switches are frequent. QUIC's per stream retransmission plus connection migration (switching networks without dropping the connection) is clearly better there. Inside a datacenter loss is low, QUIC has no advantage, and the industry is in no hurry to move internal traffic over.

## Should a service turn on HTTP/3

Situation: an e-commerce site with 70% of its traffic from phones, a CDN in front, and a p95 TTFB (Time To First Byte) that will not come down.

Most services do not need to change their own server at all. Behind Cloudflare or CloudFront, HTTP/3 is a switch in the CDN settings. Turn it on and the leg from user to CDN runs QUIC, while the CDN keeps fetching from origin over the original HTTP/1.1 or 2, with not a single line changed at the origin. The origin leg runs over a backbone with low loss and was never the bottleneck. So step one is to flip the switch and watch whether mobile TTFB moves in real user monitoring (RUM).

Only a fully self-hosted service without a CDN has to touch the server stack: Caddy has HTTP/3 built in, nginx needs a recent version, or put an Envoy layer in front. This step costs far more, and it is worth it only if users really connect straight to your own machines and a large share of them come over mobile networks.

Two things lead to regret. The first is the protocol mix: after turning on H3, look at the share of handshakes that actually succeed. Corporate networks often block UDP, and the browser falls back silently, so it looks like everyone is on H3 while part of the users are still on TCP. The second is CPU in the self-hosted case: QUIC's user space overhead shows up directly in machine cost.

---

SCTP came before QUIC with a cleaner design, and still never deployed on the public internet. QUIC took "the middleboxes must let it through" as a design premise from the start, and that is why its deployment succeeded.
