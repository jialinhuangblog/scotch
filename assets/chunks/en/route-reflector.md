---
title: "Route Reflector"
slug: route-reflector
brief: "Solves the scaling problem of iBGP full mesh. One router forwards for everyone, instead of n(n-1)/2 connections."
article: routing-journey
date: 2026-04-10
updated: 2026-06-15
revisions: 1
---

# Route Reflector

iBGP has a rule: a route learned from an iBGP neighbor must not be forwarded to other iBGP neighbors. This prevents loops.

But it means every router has to build an iBGP session with every other router → full mesh.

## The trouble with full mesh

```text
5 routers → 5×4/2 = 10 iBGP sessions
20 routers → 20×19/2 = 190
100 routers → 100×99/2 = 4950
```

An ISP backbone easily has hundreds of routers. 4950 sessions, each one a TCP connection to maintain and route updates to exchange. And every time a router is added, every other router needs one more session configured.

## How a Route Reflector solves it

Pick one router (or a few) as the route reflector (RR). The other routers are clients and build iBGP sessions only with the RR.

```text
Full Mesh (5 routers):        Route Reflector (5 routers):

 R1 ── R2                       R1   R2
 │╲  ╱│                           ╲  ╱
 │  R3 │                           RR
 │╱  ╲│                           ╱  ╲
 R4 ── R5                       R3   R4

10 sessions                     4 sessions
                            (RR is one of the 5, assigned the role)
```

A client sends its routes to the RR, and the RR "reflects" them to the other clients. This breaks the "iBGP does not forward" restriction. Loop prevention relies on two fields. When the RR reflects a route, it adds its own cluster-id to the route; a route that comes back to the same cluster is dropped. The originator-id records the router that first brought the route into the AS; when the route reaches that router again, it is dropped too.

## Deployment in practice

- Usually two RRs are deployed for redundancy; if one goes down, the other takes over
- The RR only reflects routing information; packets do not necessarily pass through it
- RR clients do not need to know about each other, which lowers configuration complexity

## Relation to the IGP

The RR solves the scaling problem of iBGP and does not affect the IGP. The IGP (OSPF, IS-IS) runs as usual and handles internal paths. The RR only handles "how external routing information is distributed inside the AS".
