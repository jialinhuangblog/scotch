---
title: "A packet crosses the public internet. What stops anyone from reading or changing it?"
slug: security-journey
subtitle: "Encryption is not the same as security. TLS protects the content and IPsec protects the packet, but when the user types a password into a phishing site, neither one can help."
chapter: "networking"
tags: [tls, tcp, encapsulation]
date: 2026-04-07
updated: 2026-10-17
revisions: 1
related: [packet-journey, dns-journey, routing-journey]
---

# A packet crosses the public internet. What stops anyone from reading or changing it?

In [Packet Journey](article://packet-journey) the packet passes through several routers. Every one of them can read the IP header. Without encryption, passwords, tokens and credit card numbers pass through every router in plain text.

This journey meets these protocols:

| Protocol | Layer | What it does | Where it appears |
|---|---|---|---|
| TLS | L5-6 Session/Presentation | encrypts application data | HTTPS, API calls |
| IPsec | L3 Network | encrypts the whole IP packet | VPN, site-to-site |
| SSH | L7 Application | encrypts remote sessions | replaced Telnet |
| Telnet | L7 Application | remote session in plain text | historical contrast |
| DNSSEC | L7 Application | signs DNS responses | stops DNS forgery |

---

## What is protected, and at which layer

| | TLS | IPsec | SSH |
|---|---|---|---|
| What it protects | application data | the whole IP packet | a remote shell session |
| Which layer | L5-6 (above TCP) | L3 (IP layer) | L7 (Application) |
| Who uses it | browsers, APIs, database connections | VPN, enterprise site-to-site | engineers connecting to servers |
| What a router in the middle sees | IP header + TCP header (plain text), payload encrypted | depends on the mode (see below) | IP header + TCP header (plain text), payload encrypted |

TLS and SSH both run above TCP, so a router can still read the IP and TCP headers. It knows where the packet is going and on which port, but it cannot read the content.

IPsec works at the IP layer. In tunnel mode, even the original IP header is encrypted.

---

## TLS: the encrypted channel

[TLS](chunk://tls) is the one you meet most often. HTTPS is HTTP + TLS.

### The handshake

TLS 1.3 finishes in one RTT:

```
Client → ClientHello (supported cipher suites, key share)
Client ← ServerHello (chosen cipher suite, key share, certificate)
Client → Finished (encryption begins)
```

This step relies on Diffie-Hellman key exchange. Each side generates its half of the key, they exchange the public parts, and each side computes the same shared key. The shared key never travels over the network.

A man in the middle who captures the ClientHello and ServerHello still cannot compute the shared key.

### The certificate

During the handshake the server sends a certificate. The certificate binds a domain name to a public key. The chain of trust:

```
Root CA (trusted by the browser in advance)
  → intermediate CA signs
    → the server's certificate
```

The client checks: was this certificate signed by a CA the browser trusts, does the domain match, has it expired. If any check fails, the connection ends.

**Let's Encrypt** automated certificate issuance. Certificates used to cost money. Now they are free, and auto-renewal is the default practice.

### mTLS

In ordinary TLS only the client verifies the server. mTLS (mutual TLS) goes both ways: the server verifies the client's certificate too.

mTLS is common for service-to-service traffic. Microservices verify each other with certificates instead of usernames and passwords. A service mesh (an architecture like Istio that puts a proxy next to every service) issues and rotates these certificates for every service automatically.

### What TLS costs

| Item | Cost |
|---|---|
| Handshake latency | TLS 1.3 one RTT. TLS 1.2 two RTTs |
| CPU | the handshake uses asymmetric encryption (expensive); everything after uses symmetric encryption (cheap, with AES-NI hardware acceleration) |
| 0-RTT resumption | a repeat connection can skip the handshake, at the risk of a replay attack |

On a long-lived connection these costs are barely noticeable. When many short connections arrive together, the handshake latency adds up and becomes obvious. HTTP/3 (QUIC) merges the TLS handshake with the transport handshake into one RTT, and a repeat connection can reach 0-RTT.

---

## IPsec: encryption at the IP layer

IPsec protects the IP packet itself, not only the application data. It has two sub-protocols:

| | AH (Authentication Header) | ESP (Encapsulating Security Payload) |
|---|---|---|
| What it does | verifies integrity (nothing was changed) | encrypts + verifies integrity |
| Encrypts? | no | yes |
| In practice | almost nobody uses it alone | the mainstream choice |

### Two modes

**Transport Mode:** only the payload (TCP/UDP and above) is encrypted. The IP header stays in plain text. Used host-to-host.

```
[IP Header plain text] [ESP Header] [TCP+Data encrypted] [ESP Trailer]
```

**Tunnel Mode:** the whole original IP packet is encrypted, then wrapped in a new IP header. Used for site-to-site VPN.

```
[New IP Header] [ESP Header] [original IP Header + TCP + Data, all encrypted] [ESP Trailer]
```

In tunnel mode, routers in the middle see only the new IP header. The original source IP and destination IP are hidden inside the encryption.

### Enterprise VPNs usually use an IPsec tunnel

A VPN between two company offices is usually IPsec tunnel mode. The VPN gateway at each end encrypts and decrypts. The packet crosses the public internet in between, and none of the routers along the way can read what is inside.

---

## From Telnet to SSH

In the 1990s you connected to a remote server with Telnet. The username and password traveled in plain text.

```
Telnet:  account admin → plain text → anyone who captures it can read it
SSH:     account admin → encrypted → a man in the middle sees only garbled bytes
```

SSH (Secure Shell) encrypts the whole session. Almost every remote connection today uses SSH.

SSH has two ways to authenticate:
1. **Password.** The password travels through the encrypted channel. Safe in transit, but the password itself can be guessed.
2. **Key.** The client holds a private key, the server holds the public key. No password is sent, so there is nothing to guess.

---

## Encrypted. Is it secure now?

Encryption solves "someone reads or changes the data in transit". But that is not the only security problem:

| Threat | Does encryption stop it | How to stop it |
|---|---|---|
| Man in the middle, eavesdropping | TLS and IPsec both stop it | solved |
| Man in the middle, tampering | TLS and IPsec verify integrity | solved |
| DNS tampering (connecting to a fake server) | TLS certificate verification catches it | DNSSEC + TLS |
| Server compromised | encryption protects transit, not the server | WAF, patches, access control |
| User types the password into a phishing site | encryption works as usual and cannot stop it | logins that resist phishing, such as passkeys and FIDO2 security keys, plus user education |

The HTTPS padlock only guarantees that transit is secure. It does not guarantee that the server on the other end can be trusted.

---

## BGP Hijack: the route changed, and encryption does not help

One more class of threat is missing from the table above: the packet never reaches where it should go. Internet routing relies on BGP (Border Gateway Protocol). AS (Autonomous System) networks announce to each other "I can reach these prefixes". BGP trusts every AS by default. Any AS can announce any prefix, and nothing verifies it.

The classic incident from 2008, as a timeline:

1. **Normally**: YouTube (AS36561) announces its `208.65.152.0/22`.
2. **18:47 UTC**: the Pakistani government wants to block YouTube. Pakistan Telecom (AS17557) announces a more specific `208.65.153.0/24` (inside YouTube's `/22`) in its own BGP, to steer domestic traffic to its own router and drop it.
3. **An accidental leak**: this `/24` passes over eBGP to the upstream transit provider PCCW (AS3491). PCCW forwards it to the whole world without checking.
4. **Other ASes accept the route**: routers worldwide add this `/24` to their routing tables. Forwarding then uses longest prefix match. The `/24` (256 IPs) has a longer mask than the `/22` (1024 IPs), so every packet for the `.153.x` block, where YouTube's servers sat, goes to Pakistan. Traffic floods into Pakistan and is dropped. YouTube is unreachable worldwide.
5. **20:07 UTC**: YouTube first announces the same `208.65.153.0/24`. A prefix of equal length competes through normal path selection (YouTube's peers see a shorter AS path), which pulled traffic back on part of the internet but could not win everywhere.
6. **20:18 UTC**: YouTube announces two `/25` prefixes (`208.65.153.0/25`, `208.65.153.128/25`), finer than the hijack, and takes the traffic back on networks willing to accept a /25. Most ISPs filter anything more specific than a `/24` (otherwise the global routing table would grow out of control), so a `/25` is about the finest prefix that can still spread.
7. **21:01 UTC, the end**: PCCW withdraws all of Pakistan Telecom's routes, and the hijack is over. Counting from the first false announcement, the worldwide outage lasted about 2 hours 14 minutes.

### Why Pakistan's own announcement reached the whole world

BGP has no concept of a country. No AS gets priority for its announcements because it is large or a national carrier.

The first place this announcement could have been stopped was Pakistan Telecom itself. They only wanted to steer domestic YouTube traffic to their own router and drop it. That `/24` should have stayed in iBGP, or carried the `NO_EXPORT` community, so it could not leave their AS. They did neither, and the route went out with all their usual external announcements, into the eBGP session to PCCW.

The second place was PCCW. A transit provider usually sets a prefix filter on a customer session: this customer may only announce the prefixes it registered in the IRR (Internet Routing Registry), and everything else is dropped. That session had no such filter, so PCCW accepted the route and forwarded it to all of its peers.

Once forwarded, everyone else saw a route that looked completely normal: `208.65.153.0/24`, AS path `… 3491 17557`. No router checks whether AS17557 is entitled to announce that prefix. BGP does not verify origin. Every AS accepts whatever its neighbors send by default, unless it configured a filter on that session.

On a customer session the filter is easy to set: the customer has a few prefixes, registered in the IRR, and they change a few times a year at most. On an upstream session it is hard: the upstream sends you hundreds of thousands of routes at once, and there is no way to check each one for who is entitled to announce what.

### Why every router in the world switched to that route

The two routes were never compared. BGP's path selection (local preference, AS path length, MED, that whole sequence) only runs when several paths arrive for the same prefix. `208.65.152.0/22` and `208.65.153.0/24` are different prefixes. The router keeps both in its table, and neither one eliminates the other.

A packet for `208.65.153.10` arrives. The router looks it up and both entries match:

```
208.65.152.0/22  covers .152.0 ~ .155.255   ← matches
208.65.153.0/24  covers .153.0 ~ .153.255   ← also matches, and the mask is longer
```

The lookup rule is longest prefix match: the entry with the longest mask wins. IP forwarding has worked this way from the start. It has nothing to do with BGP policy, and no attribute can override it.

So no router ever "decided" to trust Pakistan. They received a new, more specific entry, put it in the table as usual, and every lookup after that naturally picked it. YouTube's `/22` was there the whole time, never overwritten. Packets for `.153.x` just never reached it any more. Packets for `.152.x`, `.154.x` and `.155.x` still went to YouTube.

This is also why YouTube ended up with a `/25`: an equal-length `/24` wins only where path selection already favoured YouTube, and taking back the `.153.x` traffic everywhere means going one level finer. Seen from the other side, the attacker does not need to break into any system. Announcing a false route with a more specific prefix is enough.

The defense: RPKI (Resource Public Key Infrastructure) uses digital signatures to verify "is this AS entitled to announce this prefix". It has not reached every AS yet. TLS protects the content, so even when traffic is hijacked the man in the middle cannot read it, but it cannot make the packet arrive at the right place. During those two hours in 2008, browsers around the world saw connection timeouts, not certificate warnings. The packets entered Pakistan and were dropped. TLS never got the chance to start a handshake.

---

## Security coverage at every layer

Every layer the Packet Journey passes through has its own protection:

| Layer | Protection | What it stops |
|---|---|---|
| L7 Application | SSH, HTTPS (TLS), SFTP | fake requests, weak passwords, logic flaws in the application |
| L5-6 | TLS handshake, certificate verification | the other side is not who it claims to be (man in the middle) |
| L4 Transport | TCP port filtering (firewall) | connections to services that should not be exposed |
| L3 Network | IPsec, firewall IP rules, RPKI | spoofed source IPs, rerouted traffic |
| L2 Data Link | 802.1X (port authentication), MAC filtering | someone plugs their own laptop into the meeting room network jack |
| L1 Physical | physical isolation, access control | someone walks into the server room, pulls a cable, plugs in their own machine |

BGP hijack belongs to L3. What ASes exchange is "which prefix goes which way", and what it changes is the L3 forwarding table on every router, so RPKI sits in the L3 row (the BGP session itself runs over TCP 179, but that is the transport, not the layer it works on).

Defense in depth means setting up protection at every layer, and never expecting any one layer to stop every attack.

---

## Back to the Packet Journey

When a packet passes through a router, the router can read the IP header. With TLS, the router cannot read the HTTP content. With IPsec tunnel mode, the router cannot even read the original IP.

However it is encrypted, the packet still has to walk every step of the Packet Journey: encapsulation, ARP, router forwarding.

---

## References

- [YouTube Hijacking: A RIPE NCC RIS case study](https://www.ripe.net/about-us/news/youtube-hijacking-a-ripe-ncc-ris-case-study/) — the full story of the 2008 Pakistan Telecom YouTube BGP hijack
