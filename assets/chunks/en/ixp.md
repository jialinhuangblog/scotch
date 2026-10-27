---
title: "IXP (Internet Exchange Point)"
slug: ixp
brief: "A physical exchange facility where ASes interconnect directly, skipping transit to save money and latency."
article: routing-journey
date: 2026-04-10
---

# IXP (Internet Exchange Point)

When ASes need to exchange traffic, the obvious way is through a transit provider: pay a large ISP to forward it for you. But as traffic grows, transit gets expensive and roundabout, and latency goes up with it.

An IXP is a physical facility where multiple ASes plug their routers in and interconnect directly, without going through transit.

## The world without an IXP

```text
AS-A (small Taiwanese ISP)
  │
  │ paid transit
  ▼
AS-B (international transit provider)
  │
  │ paid transit
  ▼
AS-C (content provider)
```

For A to reach C, traffic takes two hops, A→B and B→C, and both A and C pay B for transit.

## The world with an IXP

```text
┌─────────── IXP ───────────┐
│                           │
│  AS-A ─── switch ─── AS-C │
│                           │
└───────────────────────────┘
```

A and C both plug into the same IXP and set up peering over BGP. Traffic goes directly, with no transit. Both sides save money, and latency is lower.

## Peering vs Transit

| | Peering (IXP) | Transit |
|---|---|---|
| Cost | usually free (settlement-free) or low | billed by traffic |
| Routes | only each other's routes | the other side's full routing table |
| Fits | two ASes with heavy direct traffic between them | reaching the whole internet |

Large CDNs (Cloudflare, Akamai) have a presence at IXPs all over the world. That is one reason their latency is low.

## Scale

More than 1,000 IXPs worldwide. TWIX (Taiwan), HKIX (Hong Kong), DE-CIX (Frankfurt, among the largest in the world; peak traffic at that one site passed 18 Tbps in 2025). One IXP may have hundreds of ASes connected.

---

## References

- [DE-CIX Frankfurt traffic statistics](https://www.de-cix.net/en/locations/frankfurt/statistics) — peak traffic at one site
- [Internet Society Pulse: counting IXPs worldwide](https://pulse.internetsociety.org/en/blog/2025/06/counting-ixps-and-ixp-databases/)
