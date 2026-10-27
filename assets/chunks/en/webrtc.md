---
title: "WebRTC"
slug: webrtc
brief: "The server only makes the introduction; audio and video go browser to browser. The price of low latency is handling signaling and NAT yourself."
date: 2026-07-12
updated: 2026-10-18
revisions: 2
article: webrtc-nat-traversal
---

# WebRTC

> Every WebSocket message passes through the server. A video call carries a lot of traffic and cannot afford delay. Can two browsers send to each other directly?

## A different topology

```
WebSocket:  browser A → server → browser B
WebRTC:     browser A ─────────→ browser B
```

Work out the difference. Google Meet's network planning page puts one 720p video stream at up to 1.7Mbps. Over WebSocket, A's video first uploads to the server, and the server sends it on to B. B's video does the same: it reaches the server first and then goes to A. So for every call the server receives two streams and sends two, 3.4Mbps in and 3.4Mbps out. Ten thousand calls at once is 34Gbps in and 34Gbps out. If A is in Taipei, B in Taichung and the server in Tokyo, the video also detours through Tokyo. Over WebRTC, for the calls where the direct connection succeeds, A's packets go straight to B, the server handles not one bit of video, and the path is the shortest possible. The calls where the direct connection fails fall back to a TURN relay, and their video passes through the TURN server for the whole call. Each of those calls uses about as much bandwidth as the numbers above.

## The server is still needed, but only to make the introduction

Before the connection, the two browsers do not know where the other is. Walk through it. A presses call. The browser produces an SDP offer that says "I support VP8 and H.264, audio in Opus" and lists its candidate addresses. A sends this offer to the server over WebSocket, and the server passes it to B. B takes it and replies with an SDP answer, "VP8 and Opus then", which goes back to A through the server the same way. This part is called signaling. WebRTC does not specify how signaling is done; WebSocket is the usual choice, and HTTP polling works too. Once both sides hold the other's address and codecs, they start sending to each other directly, and the server leaves the data path.

How two browsers behind NATs actually reach each other, with STUN to learn the address and TURN as the relay of last resort, is in [STUN / TURN](chunk://stun-turn).

## After one to one

Ten people in a meeting: each one opens a connection to the other nine and uploads their own video nine times. Nine streams at 1.7Mbps is 15.3Mbps upstream, more than most home connections have. The number of connections grows as N². In practice group calls use an SFU (Selective Forwarding Unit) instead. Each person uploads one copy to the SFU, and the SFU copies and forwards it to the other nine without decoding or re-encoding, which is far cheaper than a server that transcodes.
