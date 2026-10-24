---
title: "IGP (Interior Gateway Protocol)"
slug: igp
brief: "Routing protocols inside an AS. RIP counts hops, OSPF computes the shortest path."
article: routing-journey
date: 2026-04-08
updated: 2026-10-18
revisions: 4
---

# IGP (Interior Gateway Protocol)

Routing protocols inside an AS. They let the routers of one organization know the paths to each other.

## Common IGPs

| Protocol | Type | Cost based on | Where used |
|---|---|---|---|
| RIP (Routing Information Protocol) | distance vector | hop count (max 15) | small and medium networks, teaching |
| OSPF (Open Shortest Path First) | link state | bandwidth (reference bandwidth ÷ link bandwidth) | large networks, industry mainstream |
| IS-IS (Intermediate System to Intermediate System) | link state | similar to OSPF | ISP backbones |
| EIGRP (Enhanced Interior Gateway Routing Protocol) | hybrid | bandwidth + delay | Cisco environments |

## OSPF (Open Shortest Path First): computing the shortest path

There are two paths from R1 to R4. One is a direct link over an old 100 Mbps line; the other goes around through R2 and R3, with all three segments at 10 Gbps.

```text
R1 ──────── 100 Mbps ──────── R4        RIP:  1 hop, picks this one
R1 ─10G─ R2 ─10G─ R3 ─10G─ R4           OSPF (reference raised to 100 Gbps): cost 10+10+10 = 30, picks this one
```

RIP only counts hops: the direct link is 1 hop and the detour is 3, so it picks the direct link and all the traffic squeezes onto the 100 Mbps line. OSPF's cost is the reference bandwidth divided by the link bandwidth, and on Cisco IOS the default reference bandwidth is only 100 Mbps, so every link at 100 Mbps or faster gets cost 1. With the default, the direct link costs 1 and the detour 1+1+1 = 3, and OSPF picks the direct link just like RIP. So a network with 10 Gbps links raises the reference bandwidth with `auto-cost reference-bandwidth`. With the reference set to 100 Gbps, a 10 Gbps link costs 10 and a 100 Mbps link costs 1000. The three detour segments add up to 30, the direct link is 1000, and only then does OSPF pick the detour. Every router knows the topology of the whole area and runs Dijkstra itself, without relying on neighbors to relay paths.

A large network is split into several areas, connected through area 0 (the backbone). Changes are broadcast only within the area, so convergence is fast. OSPF is the most widely used IGP in the industry.

## The other members

RIP only counts hops, with a limit of 15, and cannot tell bandwidth differences apart; today it shows up almost only in teaching. IS-IS has almost the same logic as OSPF but runs directly on Layer 2 and does not depend on IP, which makes it a common choice for ISP backbones. EIGRP was originally a Cisco proprietary protocol and was published only in 2016 as RFC 7868; networks that mix vendors usually do not pick it.

## Relation to BGP (Border Gateway Protocol)

IGP decides how to route inside an AS; BGP decides how to route between ASes. The same router may run both OSPF and BGP, and Administrative Distance then decides which wins. Administrative Distance is a trust score for each protocol; the route with the lower number wins, for example eBGP is 20 and OSPF is 110.
