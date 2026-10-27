---
title: "ARP (Address Resolution Protocol)"
slug: arp
brief: "You know the IP but not the MAC. ARP asks by broadcast and caches the answer."
article: packet-journey
date: 2026-04-07
updated: 2026-07-20
revisions: 2
---

# ARP (Address Resolution Protocol)

The laptop knows the gateway's IP is `192.168.1.1`. But the Ethernet frame header needs a MAC address, and an IP does not fit there. ARP translates the IP into a MAC.

## How it asks

1. The laptop broadcasts an ARP request: "Who has IP `192.168.1.1`? Tell me your MAC."
2. `192.168.1.1` sends an ARP reply: "My MAC is `AA:BB:CC:DD:EE:FF`."
3. The laptop stores this IP → MAC pair in its ARP cache.
4. The next packet to the same IP looks up the table directly, with no new broadcast.

ARP only works inside a LAN. For a destination on another network segment, the sender does not need that host's MAC, only the gateway's MAC. The packet goes to the gateway first, and the router forwards it onward.

## The life of an ARP cache entry

ARP cache entries are not permanent; they expire:

- **macOS**: by default an entry is deleted after about 20 minutes with no traffic
- **Linux**: after roughly 15 to 45 seconds without reconfirmation an entry goes stale and is probed again on next use; entries unused for a long time are reclaimed

Expiry handles devices going offline and IPs being reassigned. The ARP cache is a **snapshot of the neighbors reachable right now**, not a history.

## How the ARP cache and the routing table split the work

| | Routing table | ARP cache |
|---|---|---|
| Decides | Which interface to leave from and which gateway is the next hop | The MAC of the next hop |
| Matches on | Destination IP (longest prefix match) | IP of the next hop |
| When used | First step of sending a packet | After the routing decision |

The flow:

1. Send a packet to `8.8.8.8`.
2. Look up the routing table: leave via en0, hand it to the gateway `192.168.0.1` as the next hop.
3. Look up the ARP cache: the MAC of `192.168.0.1` is `fa:34:5a:6a:92:24`.
4. Build the Ethernet frame: dst MAC = `fa:34:5a:6a:92:24`, dst IP = `8.8.8.8`.
5. Send it out en0.

## The IPv6 replacement

IPv6 has no ARP. **NDP (Neighbor Discovery Protocol)** takes its place, built on ICMPv6 and using multicast instead of broadcast. Its behavior and role match ARP; it just lives in the IPv6 stack.

## How ARP and DHCP split the work

[DHCP](chunk://dhcp) solves "I have no IP yet". ARP solves "I know the IP but not the MAC". When a device joins the network, DHCP first hands out the IP, gateway and DNS. After that, every time a packet is sent, ARP finds the MAC of the next hop.
