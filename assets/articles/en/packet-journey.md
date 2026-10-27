---
title: "What each layer adds to a packet before it is sent"
slug: packet-journey
subtitle: "The MAC changes at every hop. The IP address changes only at NAT."
chapter: "networking"
tags: [encapsulation, arp, tcp, dns]
date: 2026-04-07
updated: 2026-10-17
revisions: 1
related: [dns-journey, routing-journey, security-journey, four-interfaces-one-pod]
---

# What each layer adds to a packet before it is sent

Type `curl https://api.example.com` in a terminal, and in under a second JSON appears on the screen.

What happened in between?

The data leaves this laptop, passes through several machines it has never touched, and reaches a server on the other side of the planet. The response comes back, and the return trip does not always take the same route.

The journey passes through these protocols:

| Protocol | Layer | What it does | When it appears |
|---|---|---|---|
| DHCP | L7 Application | hands out the IP, gateway and DNS server | the first step after joining the network |
| DNS | L7 Application | translates a domain name into an IP | before the packet is sent |
| TCP | L4 Transport | reliable transport, port to port | the encapsulation stage |
| ARP | L2 Data Link | translates an IP into a MAC | before each hop sends the frame |
| NAT | L3 Network | swaps the private IP for a public IP | when the packet leaves the home router |
| ICMP | L3 Network | what ping and traceroute run on | debugging |

---

## DHCP: get an IP, a gateway and a DNS server

When the laptop has just joined the Wi-Fi, it has no IP yet. It does not know where the gateway is, or which DNS server to use.

DHCP provides these settings. The laptop broadcasts a message: "Can anyone give me an address?" The DHCP server on the router answers: "Your IP is `192.168.1.42`, the gateway is `192.168.1.1`, the DNS server is `8.8.8.8`."

The laptop now has these three settings:

| Setting | From | Role |
|---|---|---|
| IP address `192.168.1.42` | DHCP | the door number on the network |
| Gateway IP `192.168.1.1` | DHCP | the exit from the local network |
| DNS Server IP `8.8.8.8` | DHCP | the translator from domain name to IP |

There is also a MAC address the network card has from the factory. 48 bits, burned into the card. The format is `00:AA:BB:CC:DD:EE`. The first half `00:AA:BB` is the manufacturer code (OUI), assigned by the IEEE. The second half `CC:DD:EE` is the device number, unique within one manufacturer.

---

## Name to address

In `curl api.example.com`, the `api.example.com` part is for people. The machine needs an IP.

The laptop asks the [DNS](chunk://dns) server: what is the IP of `api.example.com`? DNS answers `93.184.216.34`. This lookup is a packet journey of its own, over UDP port 53.

The destination is settled.

---

## Packing

`curl` wants to send an HTTP GET request. The data gets wrapped from the top down, layer by layer. Each layer adds its own header, like nesting envelopes:

```
Application    HTTP GET /api/data              ← the letter itself
TLS            encrypted into a TLS record     ← a locked box nobody on the way can open
Transport      + TCP header (src:52341 dst:443) ← small envelope, with the door number
Network        + IP header  (src:192.168.1.42 dst:93.184.216.34) ← medium envelope, with the city address
Data Link      + Ethernet header (src MAC:laptop dst MAC:???) ← large envelope, with the courier station
```

The outermost layer is the [Ethernet frame](chunk://encapsulation). The innermost is the HTTP data, and because the URL is https, it is encrypted with [TLS](chunk://tls) before it goes to TCP. The machines on the way can read the TCP, IP and Ethernet headers, but `GET /api/data` is ciphertext; run tcpdump on port 443 in the middle and what you capture is a TLS record. Unpacking goes the other way: the server on the far side receives the frame, strips the headers one by one, and only after decrypting the TLS does it have the HTTP request.

<iframe src="https://jialin00.com/packets/goes-and-comes?phase=encapsulation" width="100%" height="500" style="border:none;" loading="lazy"></iframe>

But the destination in the IP header is `93.184.216.34`, while the Ethernet header needs the destination's MAC, and the laptop does not know the MAC of `93.184.216.34`.

---

## Find the MAC of the next hop

The laptop only needs the MAC of the next hop. `93.184.216.34` is not on the local network, so the laptop checks its routing table: "The destination is not in `192.168.1.0/24`. Send it to the gateway `192.168.1.1`."

So what is the MAC of `192.168.1.1`?

[ARP](chunk://arp) finds it, in four steps:

1. The laptop broadcasts: "Whose IP is `192.168.1.1`? Tell me your MAC."
2. The gateway answers: "I am `192.168.1.1`, my MAC is `AA:BB:CC:DD:EE:FF`."
3. The laptop stores the IP → MAC mapping in its ARP table. Next time it does not have to ask.
4. The destination MAC in the Ethernet header is set to the gateway's MAC.

What goes in is the gateway's MAC, not the MAC of the final destination server.

<iframe src="https://jialin00.com/packets/goes-and-comes?phase=arp" width="100%" height="500" style="border:none;" loading="lazy"></iframe>

---

## Through the first router

The frame reaches the gateway (the home router), and the router does these steps in order:

1. **Strip L2.** Drop the Ethernet header and read the IP packet.
2. **Check the routing table.** Which way does `93.184.216.34` go? The next hop is the ISP router `203.0.113.1`.
3. **Attach a new L2.** The source MAC becomes the router's own, and the destination MAC becomes the ISP router's MAC.

NAT also happens on this box. The router swaps the source IP from the private `192.168.1.42` to its own public IP. The source IP the ISP sees is not the laptop, it is the router.

The packet has left the house.

<iframe src="https://jialin00.com/packets/goes-and-comes?phase=router" width="100%" height="500" style="border:none;" loading="lazy"></iframe>

---

## Hop by hop

When the ISP router receives the frame, it does exactly the same steps: strip L2, read L3, check the routing table, attach a new L2, send.

So along the whole path, **the IP address stays the same, and the Ethernet header changes at every hop.** The exception is the NAT done by the home router earlier, which swapped the source IP. Also, the TTL in the IP header drops by 1 at every router, so the header itself is not completely untouched.

| | MAC | IP |
|---|---|---|
| Role | find the next stop | find the final destination |
| Changes | at every hop | never (except NAT swapping the source IP) |
| Analogy | the boarding pass for a connecting flight | the destination on the passport |
| Layer | L2 Data Link | L3 Network |

---

## Arrival

After some number of hops, the frame reaches the local network where the destination server sits. The last router uses ARP to get the server's MAC and sends the frame straight to it.

The server receives the frame and unwraps it layer by layer:

```
Ethernet header → strip → IP packet
IP header       → strip → TCP segment
TCP header      → strip → TLS record
TLS record      → decrypt → HTTP GET /api/data
```

The application handles the request, builds the response, packs it and sends it back, and the JSON appears in the terminal.

A router looks at only two layers: L2 to find the next hop, L3 to decide which way to go.

<iframe src="https://jialin00.com/packets/goes-and-comes?phase=arrival" width="100%" height="500" style="border:none;" loading="lazy"></iframe>

---

## When debugging, find which layer broke

When a connection fails, you can check layer by layer from the bottom up:

| Command | Layer tested | Question asked |
|---|---|---|
| `arp -a` | L2 | Do I know the gateway's MAC? |
| `ping 93.184.216.34` | L3 | Can the packet reach the other side? |
| `traceroute 93.184.216.34` | L3, hop by hop | At which hop does the packet stop? |
| `curl https://api.example.com` | L7 | Is HTTP the problem? |
| `openssl s_client -connect ...` | TLS | Is the certificate the problem? |

`ping` works but `curl` fails? The problem is at L4 or above. `ping` fails? L3 or below. No gateway in `arp -a`? Something is wrong at L2.

### How to read `arp -an` output

The output of `arp -an` looks like this:

```text
? (192.168.0.1)   at fa:34:5a:6a:92:24  on en0 ifscope [ethernet]
? (192.168.0.96)  at b6:87:83:15:0a:1d  on en0 ifscope permanent [ethernet]
? (192.168.0.164) at f6:d9:fc:8a:68:d1  on en0 ifscope [ethernet]
? (224.0.0.251)   at 01:00:5e:00:00:fb  on en0 ifscope permanent [ethernet]
```

What each field means:

- **`?`**: the hostname was not resolved (`-n` skips the reverse lookup)
- **`at MAC`**: the MAC address learned
- **`on en0`**: which interface it was learned on
- **`permanent`**: a local interface (the machine's own IP) or a multicast group; it never expires
- Everything else: dynamically learned neighbors, which expire over time

So of the two entries marked `permanent` above, `192.168.0.96` is this machine's **own interface**, and `224.0.0.251` is the multicast group used by mDNS.

### Why neighbors you never connected to are in the cache

Running `arp -an` often shows a pile of IPs this machine never connected to on its own. These entries have three sources:

1. **Gratuitous ARP / ARP announcements**: when a device joins the network or renews its DHCP lease it broadcasts its own IP and MAC once (RFC 5227), and every machine on the segment that hears it records the pair
2. **ARP requests from neighbors**: when a neighbor looks for this machine's MAC, the request carries the neighbor's own IP and MAC. The kernel answers and records the sender at the same time
3. **ARP scans**: the router or another device on the network sweeps the whole subnet with ARP now and then, and every request carries the scanner's IP and MAC. Note that IP-level broadcasts such as mDNS, DHCP and SSDP create no ARP entry; the kernel fills the ARP table only from ARP packets

### The effect of private MACs

Modern devices (Apple especially) turn on **MAC address randomization**: each WiFi network gets a different random MAC in place of the hardware MAC. The direct effect on ARP:

- The same iPhone switching SSID (say from 2.4G to 5G) may switch to a different MAC
- The router's ARP cache and DHCP client list show "two entries that look different but are the same device"

If the second bit from the right in the first byte is 1, the address is **locally administered** (randomly generated); if it is 0, it is the manufacturer's hardware address:

```text
fa:34:5a:...  →  fa = 1111 1010 → second bit from the right = 1 → locally administered (random)
00:1b:63:...  →  00 = 0000 0000 → second bit from the right = 0 → hardware MAC (Apple OUI)
```

With phones and laptops turning on random MACs by default, many of the MACs seen on a home network are locally administered.

---

## The whole trip in review

```text
DHCP gets the address
  → DNS looks up the IP
    → encapsulation (HTTP → TCP → IP → Ethernet)
      → ARP asks for the gateway MAC
        → send the frame
          → Router: strip L2 → read L3 → attach new L2 → send
            → ... repeat ...
              → arrival → unwrap (Ethernet → IP → TCP → HTTP)
                → response comes back (the return trip does not always take the same route)
```
