---
title: "Why video calls skip the server: WebRTC's P2P, signaling and NAT traversal"
slug: webrtc-nat-traversal
date: 2026-07-07
subtitle: "WebSocket sends everything through the server. WebRTC connects browsers directly, and the server only makes the introduction. After that, how do two browsers hiding behind NAT find each other?"
chapter: "networking"
tags: [webrtc, nat, stun, turn, p2p, signaling, realtime]
related: [message-system-axes, http-realtime-pushing, why-udp]
---

# Why video calls skip the server: WebRTC's P2P, signaling and NAT traversal

[WebSocket](chunk://websocket), [SSE](chunk://sse), SignalR: these realtime approaches all work the same way. Client to server, and every message passes through your own server.

Video calls do not use them. Why?

Because if every video frame were relayed through the server, latency would gain one extra hop, and everyone's video traffic would run on that one server's bandwidth. In a meeting of ten people the server takes in ten streams and sends out ninety. That path becomes the bottleneck fast.

WebRTC changes the topology.

---

## One call runs two protocol stacks at once

A video call actually runs two protocol stacks at the same time, one over TCP and one over UDP, each with its own job:

| | Introductions, chat, notifications (reliability first) | Audio and video media (realtime first) |
|---|---|---|
| L7 application | WebSocket / SSE / HTTP | SRTP, DTLS, SCTP, STUN/TURN/ICE |
| L4 transport | TCP: retransmit lost packets, guaranteed delivery | UDP: a lost packet is dropped, no waiting |
| L3 network | IP | IP |

What each of the four on the right does:

- **SRTP**: the audio and video itself, the encrypted version of RTP
- **DTLS**: the UDP version of TLS, for the handshake and key exchange
- **SCTP**: DataChannel runs on this, wrapped inside DTLS
- **STUN / TURN / ICE**: tools for setting up the connection; they step aside once media flows (TURN is the exception, it stays on the path as a relay)

The media side insists on UDP, because TCP retransmits lost packets, and while it retransmits, every packet behind it waits in line. When video loses one frame, the retransmitted copy is already stale by the time it arrives. Better to drop it and keep playing.

WebRTC means the stack on the right. The TCP side on the left does not go away; it handles the introduction (signaling).

---

## From relaying through the server to connecting browsers directly

```
WebSocket / SignalR:  browser A → server → browser B   (everything passes through the server)
WebRTC:               browser A ─────────→ browser B   (direct, the server is not on the data path)
```

A direct connection is the shortest path, with the lowest latency, and the server never touches the media stream. WebRTC was designed for realtime media like audio and video from the start.

But to connect directly, the two browsers first have to know where the other one is on the network. How do they find out?

---

## The introduction: you implement signaling yourself

Browsers sit behind NAT ([Network Address Translation](chunk://nat-gateway)) and firewalls, with no public address. A has no idea where B is. So before the connection there is an introduction step, exchanging "where I am and which codecs I support". This process is called signaling.

**WebRTC does not specify how signaling works. You implement it yourself.** With what? Usually WebSocket or SignalR.

```
A ── WebSocket ──→ server ── WebSocket ──→ B    first the server helps both sides announce where they are
A ←──────────── direct P2P ─────────────→ B    once introduced, media takes this path and the server steps aside
```

So WebRTC does not replace WebSocket. It comes after it. This is not protocol wrapping (WebRTC does not run inside WebSocket); it is a handover between two independent connections. First open a WebSocket (TCP) for the introduction, then open a WebRTC connection (UDP) for the media. The two coexist, and neither contains the other. The signaling step is still the old "everything passes through the server" path. Only after the handshake completes and the direct connection is up does the video stop passing through the server. This connects back to [the four questions of a messaging system](article://message-system-axes): signaling belongs to the "last mile" layer, and WebRTC only changes the topology from server to client into client to client.

---

## STUN: a mirror that shows your own public address

The introduction needs tools. The first is called STUN.

STUN answers one question only: what address does the client appear to have from the outside. It replies with the source address of the packet it received, one round trip and done, like looking in a mirror. Once you have looked, you leave. The media stream that follows does not pass through STUN.

With the addresses known, A and B send packets to each other's address at the same time, so that each side's NAT agrees to let the other side's packets in. This trick is called hole punching. A and B both being behind NAT is the normal case, and the flow goes like this:

- A asks STUN: what is my public address? It gets `1.2.3.4:5000`.
- B asks STUN: it gets `6.7.8.9:6000`.
- The two exchange these addresses through signaling.
- A sends a packet to B. The NAT records this outbound connection, and from then on it lets packets coming back from B's address through.
- Both sides do this at the same time, and the direct channel is established.

So STUN works even with both sides behind NAT. The precondition is that the port the NAT opens to the outside is the same for everyone, so that B can get in using the address A exchanged.

Most home routers are like this. So for most connections, STUN is enough.

---

## Symmetric NAT: the address STUN showed stops working

One kind of NAT is harder to deal with. It is called symmetric NAT. When connecting to different destinations, it opens a different outside port for each.

Now the address STUN showed is useless:

- A asks STUN, and the NAT opens `1.2.3.4:5000`. This is the port for "connecting to STUN".
- STUN honestly replies: A's address is `1.2.3.4:5000`.
- But when A really connects to B, the NAT sees a different destination and opens a separate `1.2.3.4:5005`.
- A gave B `:5000`. B's packets to it hit nothing, because that port only accepts replies from STUN.
- And `:5005`, the port actually opened for B, is something B knows nothing about.

---

## TURN: the relay for when you cannot get through

TURN does not look for the client's real address. It hands the client a public address "on itself", asks the other side to send there, and forwards it in.

- A asks TURN for a relay address.
- TURN replies: use `9.9.9.9:60000` (a port on TURN, not at A's home).
- A tells B through signaling: find me at `9.9.9.9:60000`.
- B sends to `9.9.9.9:60000`, and TURN forwards to A.

The biggest difference from STUN: **TURN stays on the data path the whole time**, and every packet passes through it. STUN leaves once it hands over the address; TURN relays for the whole call. This is also why TURN is expensive: it forwards all of the media traffic.

Can TURN read the call content? It knows packets are flowing, how big and how often, but it cannot read the content. WebRTC media is encrypted end to end. TURN forwards packets of encrypted data, and it has no key. Like a mail carrier: the letter passes through their hands, and they know who is writing to whom, but the envelope is sealed and they cannot open it.

---

## How many connections actually need TURN

[The callstats.io numbers published on webrtcHacks](https://webrtchacks.com/usage-stats/): monitoring 2015 to 2016, more than 100 customers, billions of call minutes, "22% of conferences need some form of TURN relay". About 9% more need to go over TCP, and 12% of sessions overall never get established at all, with 85% of those failures due to not getting through NAT or a firewall.

So the architecture should let STUN connect directly as much as possible, and leave TURN for the remaining fifth.

---

## Group calls: pure P2P fails at ten people

N people all connected to each other is N(N-1)/2 connections. Ten people is 45. And each person has to upload N-1 streams. In a meeting of ten people everyone uploads nine streams, and a home network's upload bandwidth cannot keep up.

So in practice group calls add a media server, called an SFU (Selective Forwarding Unit): each person uploads one copy to the SFU, and the SFU forwards it to everyone else.

```
1 to 1:      pure P2P direct connection
group:       each person → SFU → everyone else (the server only forwards, no transcoding)
```

Strictly speaking it is no longer P2P at this point. The server is back on the path. But an SFU and TURN are two different things. TURN is a porter: packets go around it untouched, the encryption keys are in the two endpoints' hands, it cannot decrypt the content, and logically the two ends are still directly connected. An SFU is the endpoint of every connection: each person builds a full WebRTC connection with it, encryption terminates there, and it can understand the media, which is what lets it forward selectively. It is lighter than the old architecture where "the server transcodes for everyone", but far heavier than TURN.

---

## P2P and SFU: do they use the same protocols

Yes. The stack on the right of the table at the start. The SFU is itself a WebRTC endpoint, running its own set of ICE, DTLS and SRTP with each client, and forwarding the packets it receives selectively. Moving from P2P to SFU changes who you connect to, not which protocols you use.

The downgrade happens only when a firewall blocks UDP completely: TURN can fall back to TCP, then to TLS on 443 (some corporate firewalls allow only 443, and that is the only path left). The "9% need to go over TCP" in the statistics above may include this group; the source does not break down the reasons. The cost of downgrading is the waiting in line described at the start: the picture stutters.

---

## So did WebRTC replace WebSocket

No. The server's role shrinks to matchmaker, handling the introduction (signaling), plus STUN and TURN as a safety net. That introduction step is built with WebSocket or SignalR. Audio and video that need low latency go over a direct WebRTC connection. Messages that need reliable relaying through the server go over WebSocket.
