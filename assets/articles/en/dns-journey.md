---
title: "Typing google.com: which servers the browser asks to get the IP"
slug: dns-journey
subtitle: "A domain name is looked up from the browser all the way to the authoritative server. Which servers get asked along the way?"
chapter: "networking"
tags: [dns, tcp, encapsulation]
date: 2026-04-07
updated: 2026-10-17
revisions: 1
related: [packet-journey, routing-journey, security-journey]
---

# Typing google.com: which servers the browser asks to get the IP

In [Packet Journey](article://packet-journey), the step "DNS answers `93.184.216.34`" got one sentence. It is really a complete packet journey of its own.

This journey passes through these protocols:

| Protocol | Layer | What it does | When it appears |
|---|---|---|---|
| DNS | L7 Application | translates names to IPs | every step |
| UDP | L4 Transport | DNS's default transport | query and response |
| TCP | L4 Transport | the fallback when the response is too large | when UDP cannot hold it |
| DHCP | L7 Application | gives the host the DNS server's address | at the very start |
| DNSSEC | L7 Application | signatures against DNS forgery | security verification |

---

## Where the asking starts

Type `google.com` in the browser and press Enter. The browser needs an IP, but it does not ask a DNS server right away. It checks the local caches first:

1. **Browser cache.** Recently resolved names are kept for a while. Chrome shows them at `chrome://net-internals/#dns`.
2. **The hosts file.** `/etc/hosts` (or `C:\Windows\System32\drivers\etc\hosts`). Mappings written by hand; the operating system consults it before any DNS cache.
3. **OS cache.** If hosts has nothing, the operating system checks its DNS cache. `dscacheutil -cachedump` on macOS or `ipconfig /displaydns` on Windows.

Only when all three have nothing is a DNS query actually sent.

---

## Who to ask

When the machine joined the network, DHCP handed it a DNS server IP, usually the home router or the ISP's DNS server. Some networks hand out `8.8.8.8` directly. This server is the **recursive resolver**.

"Recursive" means it runs the whole query chain. The host asks it once. It asks every server that needs asking, gets the answer, and returns it.

Between the host and the recursive resolver it is UDP port 53. A DNS query is usually small enough to fit in one UDP datagram, and this skips the latency of the TCP three-way handshake.

---

## The query chain

The recursive resolver has a cache of its own. On a miss, it starts at the very top and asks downward:

```
Recursive Resolver
  → Root Server (13 groups worldwide, answers "ask this server for .com")
    → .com TLD Server (answers "ask this server for google.com")
      → google.com authoritative server (answers "the IP is 142.250.80.46")
```

Each level knows only "who to ask next". The root does not know google.com's IP, but it knows who manages .com. The TLD does not know the IP, but it knows where google.com's authoritative server is.

### The hierarchy

```
.                    ← Root Zone (managed by IANA)
├── .com             ← TLD (Top-Level Domain)
│   ├── google.com   ← Second-Level Domain
│   │   ├── www      ← Subdomain
│   │   ├── mail     ← Subdomain
│   │   └── api      ← Subdomain
│   └── example.com
├── .org
├── .edu
└── .tw
    └── .com.tw
        └── www.com.tw
```

The full name of `www.google.com` is really `www.google.com.`. The final dot stands for the root. It is normally left out.

---

## TTL: how long to cache

When the authoritative server returns the IP, it attaches a TTL (Time To Live). It means "this answer may be cached for this long".

| TTL | Upside | Cost |
|---|---|---|
| short (30s) | fast switchover; an IP change takes effect in 30 seconds | heavy query volume, more load on the resolver |
| long (3600s) | fewer queries, less load on the resolver | after an IP change, the worst case waits an hour |

A "zero-downtime migration" depends on the TTL being short enough. With a TTL of 3600 seconds, some users keep connecting to the old server after the IP switch, for up to an hour.

In practice the TTL stays long most of the time to save queries. Before a migration, shorten the TTL so caches expire sooner, then switch the IP, and only raise the TTL again once things are stable.

---

## When UDP cannot hold it

When a DNS response exceeds 512 bytes (the traditional limit), the resolver receives a truncation marker (the TC flag). The resolver then resends the same query over [TCP](chunk://tcp) port 53.

TCP adds the latency of the three-way handshake, but it guarantees the whole response arrives.

When does a response exceed 512 bytes?

- **DNSSEC.** Signature data is large.
- **Many records.** One name maps to a large number of IPs (the CDN case).
- **Zone transfer.** Primary and secondary DNS servers syncing a whole zone, always over TCP.

EDNS (Extension Mechanisms for DNS) lets the client declare how large a UDP response it can receive. DNS Flag Day 2020 recommended 1232 bytes, because that size avoids IP fragmentation on almost every network. So most queries never need to switch to TCP, but a large response such as DNSSEC that exceeds the declared size still falls back to TCP.

---

## DNS is more than A records

DNS returns more than IPs. The most common is the A record (name to IPv4), but there are many record types, and each returns something different:

| Record type | Returns | Used for |
|---|---|---|
| A | IPv4 address | the most common |
| AAAA | IPv6 address | IPv6 environments |
| CNAME | another domain name | aliases, `www.example.com` → `example.com` |
| MX | mail server | `gmail-smtp-in.l.google.com` receives mail for `@gmail.com` |
| NS | authoritative DNS server | points the resolver at who to ask |
| TXT | arbitrary text | SPF, DKIM, domain verification |

A CNAME triggers an extra query. Looking up `www.example.com` returns the CNAME `example.com`, and the resolver then has to look up the A record of `example.com` to get the IP, so there is one more round trip.

---

## DNS security problems

DNS queries are plaintext by default. Every machine along the path can read "this laptop is looking up google.com". Worse is cache poisoning: an attacker answers with a fake IP before the authoritative server does, the resolver stores the fake IP in its cache, and everyone using that resolver is sent to the fake site.

| Threat | Defense | Level |
|---|---|---|
| Cache poisoning | DNSSEC (signature verification) | protects the authenticity of the response |
| Eavesdropping on queries | DoH (DNS over HTTPS) / DoT (DNS over TLS) | encrypts the query itself |
| Local hijacking | set a trusted resolver by hand (`8.8.8.8`, `1.1.1.1`) | bypasses the ISP |

DNSSEC verifies that the response is genuine. DoH / DoT keep the query content from being read by others.

---

## Debug DNS

| Command | What it does |
|---|---|
| `nslookup google.com` | the most basic DNS lookup |
| `dig google.com` | the full response, including TTL and the authority section |
| `dig +trace google.com` | simulates the whole query chain, starting from root |
| `dig google.com +short` | just the IP, nothing else |
| `dig @8.8.8.8 google.com` | query through Google DNS specifically |

`dig` shows the raw DNS response, while `nslookup` tidies it up, so use `dig` for debugging.

---

## Back to Packet Journey

A DNS query is itself a packet journey. The laptop wraps the DNS query as UDP segment → IP packet → Ethernet frame and sends it to the recursive resolver. The resolver may send out several more queries (root → TLD → authoritative). Every one of them goes through the same encapsulation, ARP, and router forwarding steps.

Packet Journey goes to a web server, a DNS query goes to a DNS server. Only the destination differs.

If every cache layer misses, there is one trip from the laptop to the resolver, and the resolver makes one trip each to the root, the TLD, and the authoritative server. Behind one `curl`, four packet journeys happen before a single IP comes back.
