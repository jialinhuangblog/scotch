---
title: "BGP (Border Gateway Protocol)"
slug: bgp
brief: "The routing protocol between ASes. Each AS uses it to tell other ASes which prefixes it can reach."
article: routing-journey
date: 2026-04-08
updated: 2026-07-20
revisions: 3
---

# BGP (Border Gateway Protocol)

When you connect to GitHub from Taiwan, the packet goes through Chunghwa Telecom's AS, across the Pacific to some transit AS, then into GitHub's AS. These ASes rely on BGP to know where to forward it.

BGP is the routing protocol between ASes. The border routers of each AS announce to each other over BGP: "I can reach these prefixes, through these ASes."

## How a packet finds GitHub

```text
packet → Chunghwa Telecom (AS3462)
  BGP table of AS3462:
    GitHub 140.82.112.0/20 → two routes:
      path A: AS3462 → AS1299 (Telia) → AS36459 (GitHub)     2 hops
      path B: AS3462 → AS4637 → AS1299 → AS36459 (GitHub)   3 hops
    pick path A (shorter AS path)
```

BGP does not compute the shortest path by bandwidth the way OSPF (Open Shortest Path First, the routing protocol used inside an AS) does. With no preference configured, BGP picks the route that crosses the fewest ASes. AS path is the most common basis for route selection.

## eBGP vs iBGP

```text
          eBGP                eBGP
AS3462 ────────── AS1299 ────────── AS36459
 R1 ── R2          R3 ── R4          R5
   iBGP               iBGP
```

**eBGP**: between border routers of different ASes. R2 in AS3462 and R3 in AS1299 run eBGP and exchange "which prefixes my AS can reach".

**iBGP**: inside one AS. R2 learns from R3 over eBGP that "GitHub's `140.82.112.0/20` is reachable to the right". But R1 has no eBGP session with R3, so R1 does not know this. iBGP lets R2 pass this external route to R1: "To reach GitHub, hand the packet to me. I know where to forward it."

iBGP is not an IGP (Interior Gateway Protocol, the routing protocol inside an AS). The IGP answers "how does R1 get to R2 internally" (which link, which interface). iBGP answers "which direction is GitHub in, and who forwards it" (distribution of external routes).

An analogy: the IGP is like the floor plan of an office building. It covers how to get from this office to that one. iBGP is different. It covers "to leave the building, which door is fastest". A colleague at the edge first learns from outside that "for GitHub, the north exit is fastest", then uses iBGP to tell everyone else in the building. Otherwise nobody knows which door to send things to.

## Route selection

When BGP receives several routes, it compares them in this order:

```text
1. Local Preference     → set by the administrator, higher wins
2. AS Path Length       → fewer ASes wins
3. Origin               → IGP > EGP > Incomplete
4. MED (Multi-Exit Discriminator) → the neighbor AS suggests which entrance to use
5. eBGP > iBGP          → routes learned externally win
6. IGP cost to next hop → internal cost to the next hop
```

In practice most decisions end at the first two steps. Administrators use local preference to control which line traffic takes (for example the cheaper transit), and AS path handles the rest.

### How MED is used

MED (Multi-Exit Discriminator) is one AS telling its neighbor: "If you are coming in, this entrance is more convenient." Like a house with a front door and a back door, where you tell a frequent visitor "take the alley to the back door, there is less traffic".

```text
AS1299 (Telia)          AS36459 (GitHub)
  R3 ──────────────────── R5  (MED 100)
  R4 ──────────────────── R6  (MED 50)    ← lower MED, preferred
```

GitHub sets a different MED on each exit. Telia sees two routes with the same AS path length, so it uses MED to decide → picks R4→R6. Lower MED wins.

Limits: MED is only a suggestion, and the other side may ignore it. It is also compared only among routes from the same neighbor AS, never across ASes.

## BGP Hijack

BGP has no verification built in. Any AS can announce any prefix, and a neighbor that receives it adopts it as is. On top of that, a router prefers the longest, most specific prefix when choosing a route. So even while the real route stays in place, if someone announces a more specific fake route (a `/24` inside someone else's `/22`), routers around the world switch to the fake one. In 2008, Pakistan Telecom took YouTube offline worldwide for about 2 hours this way, by accident.

Defense: RPKI (Resource Public Key Infrastructure) uses digital signatures to verify "does this AS have the right to announce this prefix". It has not yet reached every AS.
