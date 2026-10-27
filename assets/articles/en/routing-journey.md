---
title: "How a router decides where to forward a packet next"
slug: routing-journey
subtitle: "Each router looks up only its own routing table to decide the next hop. The table is written by an administrator by hand, or filled in automatically by protocols like OSPF and BGP."
chapter: "networking"
tags: [as, bgp, igp, encapsulation, arp]
date: 2026-04-07
updated: 2026-10-17
revisions: 1
related: [packet-journey, dns-journey, security-journey]
---

# How a router decides where to forward a packet next

In [Packet Journey](article://packet-journey), every router looks up its routing table to decide the next hop. So where does that routing table come from? How does a router know which interface leads to `93.184.216.34`?

This journey passes through these protocols:

| Protocol | Layer | What it does | When it appears |
|---|---|---|---|
| IP | L3 Network | the packet's addressing system | the whole way |
| ICMP | L3 Network | traceroute, TTL reports | path probing |
| RIP | L3 Network | distance vector routing | inside small networks |
| OSPF | L3 Network | link state routing | inside large networks |
| BGP | L3 Network | routing between autonomous systems | across ISPs |
| EIGRP | L3 Network | Cisco hybrid routing | Cisco environments |

---

## What a routing table looks like

Every router has a routing table. Each row says "for destinations in this subnet, send out this interface".

```
Destination        Gateway         Interface
192.168.1.0/24     direct          eth0
10.0.0.0/8         203.0.113.1     eth1
0.0.0.0/0          203.0.113.1     eth1   ← default route
```

The last row is the default route. It means "any destination I do not recognize goes here". A home router usually has only two rows: the local network is directly connected, and everything else goes to the ISP.

A router at an ISP border takes in the full global routing table, close to a million rows.

---

## Static vs dynamic

A routing table can be written by hand (static), or the router can learn it on its own (dynamic).

**Static routing:** the administrator configures it by hand. Simple to set up and predictable, but every topology change means editing by hand. It fits small, stable environments.

**Dynamic routing:** routers run a routing protocol between them, exchange path information, update their tables automatically, and converge on their own when the topology changes. Large networks have no other option.

Home routers use static. ISPs use dynamic.

---

## Autonomous systems: AS

The internet is made of many independently managed networks. Each one is called an AS (Autonomous System).

An ISP is an [AS](chunk://as). A large company may have its own AS too. Google is AS15169.

Every AS has a number (ASN). Inside an AS, an interior routing protocol (IGP) runs. Between ASes, an exterior routing protocol (BGP).

```
AS 100 (ISP A)          AS 200 (ISP B)          AS 15169 (Google)
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│  OSPF inside │──BGP──│  OSPF inside │──BGP──│  internal    │
│  the AS      │        │  the AS      │        │  routing     │
└──────────────┘        └──────────────┘        └──────────────┘
```

How an AS routes internally, the outside does not need to know. BGP exchanges only "which AS can reach which subnet".

---

## IGP: choosing paths inside an AS

[IGP](chunk://igp) (Interior Gateway Protocol) is the routing protocol inside an AS. Its job is to let the routers of one organization know each other and the paths between them.

### RIP (Routing Information Protocol)

RIP is the oldest and simplest. Its cost is hop count. Each router passed counts as one hop, and a destination more than 15 hops away is treated as unreachable. It is a distance vector protocol: each router knows only the distances its neighbors report, not what the whole network looks like.

```
A ──1 hop── B ──1 hop── C
A ──1 hop── D ──1 hop── C
```

A has two paths to C, both 2 hops. To RIP they are equally good. But what if A→B is 100 Mbps and A→D is 10 Mbps? RIP ignores bandwidth and only counts hops.

It fits small and medium networks. For a large network the 15 hop limit is too tight.

### OSPF (Open Shortest Path First)

OSPF uses Dijkstra's shortest path algorithm. By default each link's cost is computed from the interface bandwidth: more bandwidth, lower cost.

Every router holds the topology of the whole area (link state). RIP only knows the distances its neighbors report, so OSPF, unlike RIP, can compute the shortest path across the whole graph.

```
A ──cost 1── B ──cost 3── C    total cost = 4
A ──cost 8── D ──cost 5── C    total cost = 13
```

OSPF picks A→B→C (cost 4). RIP treats both as equal (2 hops each).

Large networks use OSPF. It converges fast: after a topology change, every router's table quickly updates to a consistent state. It also supports load balancing, and it can divide the network into hierarchical areas (Area).

### EIGRP (Enhanced Interior Gateway Routing Protocol)

A hybrid protocol developed by Cisco, combining the distance vector and link state approaches. By default the cost is computed from bandwidth and delay, and it can be configured to include reliability and load as well.

EIGRP was originally a Cisco proprietary protocol. It was published as RFC 7868 in 2016, but in practice it runs almost only on Cisco equipment.

### IGP comparison

| Protocol | Type | Cost based on | Fits |
|---|---|---|---|
| RIP | distance vector | hop count (max 15) | small and medium, teaching |
| OSPF | link state | mainly bandwidth | large, the industry standard |
| EIGRP | hybrid | bandwidth + delay + others | Cisco environments |
| IS-IS | link state | similar to OSPF | ISP backbones |

---

## BGP: choosing paths between ASes

[BGP](chunk://bgp) (Border Gateway Protocol) is the routing protocol between ASes. All routing between ASes across the whole internet runs on BGP.

BGP does not pick routes by distance. It compares a list of attributes in order. The common ones:

- **local preference**: a preference the AS sets itself. Higher wins, and it is compared before AS path
- **AS path**: which ASes the path passes through. Shorter is better
- **MED**: the neighbor AS's suggestion for which entrance to come in through

When no local preference is set, the result usually comes down to AS path length.

### eBGP and iBGP

| | eBGP | iBGP |
|---|---|---|
| Where | between different ASes | inside one AS |
| Role | exchange "which AS can reach which subnet" | spread the routes learned by eBGP to the routers inside the AS |

Why does an AS run iBGP inside as well? Because the border routers learned the external routes through eBGP, but the other routers inside the AS do not know them. iBGP carries that information inward.

Then why not use the IGP to carry BGP routes? Because an IGP was not designed to hold several hundred thousand routes.

So routing inside the AS goes to the IGP, and routing across ASes goes to BGP.

---

## How the best path is chosen

A router may have several paths to one destination. The choice depends on more than one factor:

| Factor | Meaning |
|---|---|
| hop count | how many routers are passed (RIP uses this) |
| bandwidth | link speed (OSPF and EIGRP use this) |
| delay | how long a packet takes on this path |
| reliability | the packet loss rate of this link |
| AS path length | how many ASes are passed (BGP uses this) |
| administrator weight | manual preference, overrides everything |

If one router runs both OSPF and BGP at the same time, Administrative Distance decides which wins. A lower AD wins. OSPF is 110, eBGP is 20, so the route learned by eBGP wins.

---

## TTL and traceroute

The IP header has a TTL field (Time To Live). Each router passed decrements TTL by 1. When it reaches 0, the router does not forward the packet. It drops it and sends back an ICMP Time Exceeded message.

`traceroute` uses this mechanism:

1. Send a packet with TTL=1. The first router decrements it to 0 and replies with ICMP. Now the first hop's IP is known.
2. Send a packet with TTL=2. The second router decrements it to 0 and replies with ICMP. Now the second hop's IP is known.
3. Repeat until the destination answers.

```bash
traceroute 93.184.216.34
 1  192.168.1.1      1.234 ms   ← home router
 2  203.0.113.1      5.678 ms   ← ISP
 3  198.51.100.1    12.345 ms   ← transit
 4  93.184.216.34   18.901 ms   ← arrived
```

A hop showing `* * *` means that router did not reply with ICMP. It may be configured not to reply, or it may rate limit its replies. The packet itself does not necessarily fail to get through.

---

## When routing goes wrong

### Routing loops

A thinks the way to C is through B. B thinks the way to C is through A. The packet bounces between A and B until TTL reaches zero.

RIP is especially prone to this. OSPF knows the whole topology, so it almost never happens there.

### BGP hijack

An AS announces a subnet it does not own. Other ASes accept the route and send traffic there. It happened in April 2018: someone used a BGP hijack to take over the subnet of Amazon Route 53 DNS, sent users connecting to MyEtherWallet to a fake server, and stole about 150,000 US dollars in Ether ([incident analysis](https://www.thousandeyes.com/blog/amazon-route-53-dns-and-bgp-hijack)).

BGP accepts the routes a neighbor announces by default, with no verification. RPKI (Resource Public Key Infrastructure) uses signatures to verify that the announcing AS really owns that subnet, but it has not yet spread to every AS.

### Convergence time

After a topology change, the time it takes for every router to update its table and agree is called convergence. OSPF takes seconds. RIP can take minutes. During convergence, packets may take a wrong path or be dropped.

---

## Back to Packet Journey

The routing table the router looks up in Packet Journey is written by an administrator by hand in a small network, and learned automatically through OSPF and BGP in a large one.
