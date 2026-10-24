---
title: "STUN / TURN"
slug: stun-turn
brief: "STUN finds your public address outside the NAT so two browsers behind NATs can connect directly; when that fails, TURN relays."
date: 2026-07-12
updated: 2026-10-18
revisions: 2
article: webrtc-nat-traversal
---

# STUN / TURN

> Both browsers sit behind a NAT with no public address. WebRTC wants a direct connection. Where does the address come from?

Start with what the NAT does. The laptop at home has the IP 192.168.1.5, and that address is only valid inside the home network. The laptop sends a packet out from port 50000. The router rewrites the source to its own public address 203.0.113.7 and port 40001, and records "40001 maps to 192.168.1.5:50000". A packet coming back to 203.0.113.7:40001 is looked up in that table and forwarded to the laptop. A packet with no entry in the table is dropped. So the laptop itself does not know the address 203.0.113.7:40001, and nobody outside can open a connection to it.

## STUN: find your own public address

A STUN server sits on the public internet. The laptop sends it a packet, the server reads which address and port the packet came from, and sends that back as is. Laptop A learns it is 203.0.113.7:40001; laptop B on the other side learns it is 198.51.100.9:62000. The two exchange these addresses through the signaling server, then send packets to each other at the same time. As soon as A sends to 198.51.100.9:62000, A's router records "40001 may receive replies from 198.51.100.9:62000", and B's router does the same. When B's packet reaches A's router, the entry is there and the packet passes. In English this trick is called hole punching. Most home routers allow a direct connection this way.

Once STUN has handed out the address it is out of the picture. The media stream never passes through it.

## TURN: relay when the direct path fails

One kind of router, the symmetric NAT, picks a new outside port for every new destination. A used 40001 when it asked STUN, but when A sends to B the router switches to 40002. B still holds 40001 and sends there. On A's router, 40001 maps to the STUN server, not to B, so the packet is dropped. The direct connection fails.

That is when it falls back to TURN. A TURN server also sits on the public internet. A asks it for a relay address, gets 203.0.113.50:49200, and passes that to B. From then on B sends there and TURN forwards to A; A sends to TURN and TURN forwards to B. Each side only talks to TURN, so neither needs the other's router to let anything through.

The cost is that TURN stays on the data path for the whole call and every video packet goes through it. Bandwidth and machines cost money. In [the numbers callstats.io published on webrtcHacks](https://webrtchacks.com/usage-stats/), covering January 2015 to February 2016 and billions of call minutes, 22% of conferences needed some kind of TURN relay.
