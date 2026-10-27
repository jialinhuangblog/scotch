---
title: "Which layer of a packet hubs, switches and routers each read"
slug: network-devices-by-layer
subtitle: "A hub reads no address, a switch and an AP read MAC, a router reads IP. A core switch and an AP are both L2, but a core switch going down cuts off a large part of the site, while an AP going down only disconnects the few devices attached to it."
chapter: "networking"
tags: [networking, osi, switch, router, ap, topology]
date: 2026-07-04
related: [packet-journey, lb-l4-l7-lab]
---

# Which layer of a packet hubs, switches and routers each read

The same network cable carries the same string of bits. But a switch reads only the outermost MAC address, while a router unwraps one more layer and reads the IP address, so the two devices do completely different things with that string of bits.

## How a packet is wrapped

A packet is [wrapped in several layers](chunk://encapsulation). The outermost is the L2 frame, inside that is the L3 packet, inside that the L4 segment, and at the very center is the application's data.

Each layer's wrapper (header) carries that layer's address. The L2 wrapper has the [MAC address](chunk://arp), the L3 wrapper has the IP address, the L4 wrapper has the port.

A device "works at layer N" means: **it unwraps down to that layer and reads that layer's address to make its decision**. A device that reads deeper can make more complex judgments, and processes more slowly. Network devices are classified exactly this way.

## How deep each device unwraps

**Hub, L1.** It unwraps nothing. A signal coming in on one port is copied unchanged to every other port. Because it reads no address, every device plugged into it receives everything. Hubs are obsolete now; they are here for contrast.

**Switch, L2.** It unwraps the outermost layer and reads the MAC address. It keeps a MAC table recording which MAC is on which port, so an incoming packet goes only to the right port and the other ports receive nothing. But it only handles the inside of one LAN; a packet cannot leave that LAN through it. Two computers in an office sending files to each other go through the switch.

**AP, L2.** It is really a wireless version of a switch. It converts WiFi wireless frames (802.11) into wired Ethernet frames (802.3), and the other way round. It reads MAC just the same, and does no routing just the same. So a pure AP sits at the same layer as a switch; the difference is that one connects wireless devices and the other wired ones.

**Router, L3.** It unwraps the second wrapper and reads the IP address. Only IP has the concept of crossing networks, so the router forwards between different networks and decides where the packet's next hop goes. An office reaching the internet goes through the router. [The journey of a packet](article://packet-journey) is about how routers forward between themselves.

**L3 switch.** A switch with routing added, reading both MAC and IP. Inside the LAN it forwards fast at L2; only when crossing subnets does it route at L3. The backbone of a large internal network often uses these.

**Firewall, L3/L4 and above.** It reads IP plus port ([L4](chunk://l4-vs-l7-lb)) and decides whether to let the packet through or drop it. A next generation firewall unwraps all the way to L7 and looks at application layer content. It is installed to filter packets; forwarding is not its main job.

**Gateway is a role, not a layer.** A gateway is a network's exit to the outside, and a router usually doubles as it. So "gateway" describes its position on the network boundary, and has nothing to do with the OSI layer.

The "WiFi router" at home is actually router, switch, and AP, **three devices packed into one box**, which is why it is easy to think they are the same kind of device. In an enterprise environment, the three are usually separate.

## The second dimension: where it sits

The OSI layer describes "what decisions this device can make". But the topology diagram has another kind of rank, which describes "where it sits, and how many people are affected when it goes down".

From outside in, an enterprise network is roughly this chain:

```
internet
  │
gateway / firewall     boundary, the only exit to the outside
  │
core switch / router   core, the site's backbone
  │
access switch          access layer, the wall jacks
  │
AP                     brings wireless devices in
  │
client                 endpoint, forwards for nobody
```

The more devices whose connections pass through it, the wider the damage when it goes down. But the **kind** of damage differs.

When the gateway goes down, the whole site cannot reach the outside, but devices inside the site can still reach each other, because internal traffic never passes through the gateway. A core switch going down is worse. It is the point everything inside the site must pass through, so when it breaks a large part of the interior loses contact. One AP going down affects only the few wireless devices connected to it, the smallest range.

So the size of the impact depends on **how many devices' connections pass through it**, not on how far upstream it is. The gateway is the mandatory point for outside traffic; the core switch is the mandatory point for inside traffic.

## Does a device further upstream sit at a higher OSI layer

No. The core switch is on the site backbone and the AP is at the very edge, and both work at L2. The gateway is furthest upstream and only reaches L3.

- The **OSI layer** decides what the device can read and what judgments it can make: MAC or IP, whether it can filter, whether it can cross subnets.
- The **topology position** decides how many devices lose their connection when it goes down. Operations alerts are also grouped by this position.

## Two questions to ask about any device

Reads MAC: switch and AP. Reads IP: router. Reads port and above: firewall.

Both are L2, yet an AP going down disconnects only the few wireless devices on it, while a core switch going down cuts off a large part of the site at once. When the gateway goes down, the site still talks to itself; it just cannot reach the outside.
