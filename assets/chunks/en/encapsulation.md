---
title: "Encapsulation"
slug: encapsulation
brief: "From the app down to the NIC, every layer adds a header. That is where Frame, Packet, and Segment come from."
article: packet-journey
date: 2026-04-07
updated: 2026-10-18
revisions: 2
---

# Encapsulation

The HTTP request you send does not arrive on the other side untouched. Every network protocol layer wraps it, adds its own header, and hands it to the next layer down.

Walk through the smallest possible request. A laptop (IP 192.168.1.20) sends `GET /orders` to api.example.com (IP 93.184.216.34).

The application layer hands over plain text, `GET /orders HTTP/1.1` plus a few header lines, say 200 bytes. This example uses unencrypted http (port 80), because https adds a TLS layer between HTTP and TCP. TCP would then receive an encrypted TLS record instead of this plain text, and the length would grow by TLS's own header and authentication data.

The TCP layer puts a 20 byte TCP header in front, holding source port 51234, destination port 80 and sequence number 1001. The result is called a segment. TCP only cares about which process talks to which process and which piece this is. It does not know which machine the other side is.

The IP layer adds a 20 byte IP header in front of that, holding source IP 192.168.1.20 and destination IP 93.184.216.34. This is called a packet. IP cares about which machine to which machine, but does not know where the next hop is.

The Ethernet layer adds a 14 byte header last, with the laptop's NIC as the source MAC and the home router's NIC as the destination MAC. Not the server's MAC, because Ethernet can only deliver to the next device on the same wire. A 4 byte FCS checksum goes on the end. This is called a frame, 258 bytes in total, and it leaves through the NIC.

```text
| Ethernet 14 | IP 20 | TCP 20 | GET /orders ... 200 | FCS 4 |
|<-------------------- frame 258 bytes -------------------->|
              |<---------- packet 240 ---------->|
                      |<----- segment 220 ----->|
```

## Each layer only reads its own header

The home router receives the frame, sees that the destination MAC is its own, strips the Ethernet header and the FCS, and exposes the IP header. The destination IP 93.184.216.34 is not the router, so it looks up the routing table for the next hop and wraps a new Ethernet header, with the destination MAC now set to the ISP's device. It never touches the HTTP content.

The home router does one more thing. 192.168.1.20 is a private address that routers on the internet do not recognize, so a reply could never come back. So the router does [NAT](chunk://nat-gateway): it replaces the source IP with its own public IP (say 203.0.113.7), may also replace source port 51234 with another one, and records this in its NAT table, so that when the reply comes in it knows which laptop to forward it to. Because the IP and port changed, the checksums in the IP header and the TCP header are recalculated too.

Past the home network, every router on the internet repeats only the earlier steps: strip the Ethernet header, look up the routing table, wrap a new Ethernet header. So the Ethernet header changes at every hop, while the source (now 203.0.113.7) and the destination in the IP header stay the same the rest of the way.

A switch in the middle does even less: it reads the MAC in the Ethernet header and does not open the IP header at all.

## Unwrapping

The server receives the frame and does it in reverse. Strip the Ethernet header to get the packet, strip the IP header to get the segment, read destination port 80 and hand it to the process listening on 80, strip the TCP header, and the remaining 200 bytes are the original `GET /orders`.
