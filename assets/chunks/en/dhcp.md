---
title: "DHCP (Dynamic Host Configuration Protocol)"
slug: dhcp
brief: "A device joins a new network and has an IP within seconds. DHCP assigned it with the four DORA steps."
article: packet-journey
date: 2026-04-11
updated: 2026-07-20
revisions: 1
---

# DHCP (Dynamic Host Configuration Protocol)

A laptop joins a new WiFi network or plugs in a network cable, and a few seconds later it has an IP. Nobody set it by hand. DHCP is what hands out IPs automatically.

## The four DORA steps

Four exchanges between the client and the server (usually the router):

```text
1. DISCOVER  Client broadcasts: "who can give me an IP?"
2. OFFER     Server → Client: "take 192.168.0.96, lease 24 hours"
3. REQUEST   Client broadcasts: "I want 192.168.0.96 (the one server X offered)"
4. ACK       Server → Client: "OK, this IP is yours, the lease starts now"
```

The first two steps are broadcasts (the client has no IP yet and does not know where the server is; the server sees the broadcast and answers). The third step is also a broadcast, so any other DHCP server that may exist learns "I have picked one, stop sending me offers". Only after receiving the ACK in step four can the client actually use the IP.

## You get more than an IP

A DHCP OFFER bundles several settings:

| Item | Example | Purpose |
|---|---|---|
| IP address | `192.168.0.96` | This device's address |
| Subnet mask | `255.255.255.0` (`/24`) | Defines the LAN range |
| Default gateway | `192.168.0.1` | Where packets leaving the subnet go |
| DNS server | `8.8.8.8` or the router itself | Who to ask for domain lookups |
| Lease time | `86400` seconds | How long this IP can be used |

DHCP delivers all of these in one OFFER, so none of them has to be set by hand one at a time.

## When the lease expires

A DHCP lease usually lasts 24 hours to 7 days. The client does not wait for expiry; it renews early at two points:

- **50% (T1)**: renew with the original server (send `DHCPREQUEST`)
- **87.5% (T2)**: the original server did not answer, so broadcast to find any server
- **Full expiry**: start over with DISCOVER

This is why the private IPs of devices at home may change after a router reboot (`192.168.0.96` becomes `192.168.0.12`, for example). If the router did not save its lease records, the new DISCOVER gets a different address. What changes is the n in `192.168.0.n`, decided by the home router's DHCP server. The router's own public IP (from the ISP) is another layer of DHCP, controlled by the ISP.

## Static Reservation: a fixed IP

The router's admin interface can set "this MAC always gets this IP":

```text
MAC: b6:87:83:15:0a:1d  →  IP: 192.168.0.96  (reserved)
```

The four DORA steps still run. The only difference is that at the OFFER stage the server finds a reservation for this MAC and returns the assigned IP directly. The client notices nothing.

Where it applies: a NAS, printer, or IoT hub at home that needs a stable IP, so port forwarding and bookmarks keep working.

## In practice: why the client list looks full of duplicates

The DHCP server records leases **keyed by MAC**; every new MAC is recorded as a new device. Modern devices with [private MAC](article://packet-journey) turned on rotate their MAC, and the router, going by MAC alone, cannot tell they are the same device. 5 devices at home showing up as 15 entries in the client list is normal.

## How DHCP and ARP divide the work

| | DHCP | [ARP](chunk://arp) |
|---|---|---|
| What it solves | I have no IP yet, who can give me one | I know the IP, how do I find the matching MAC |
| When it fires | On joining the network + periodic renewal | Every time a frame goes to a new neighbor |
| Scope | LAN (the router is usually the server) | LAN |
| Protocol position | UDP port 67/68, application layer | L2, no IP header |

The order is **DHCP assigns the IP first**, **then ARP finds the neighbors' MACs on the network** (IP → MAC).
