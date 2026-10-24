---
title: "AS"
slug: as
brief: "Autonomous system. The internet is many separately managed networks joined together."
article: routing-journey
date: 2026-04-08
updated: 2026-10-17
revisions: 3
---

# AS

The whole internet is cut into pieces, and each piece is an AS (Autonomous System).

## What an AS is

An independently managed network. An ISP is an AS. A large company may have its own AS. Google is AS15169, Cloudflare is AS13335.

Each AS has a number (ASN), 16-bit or 32-bit long. IANA hands number blocks to the regional RIRs (Regional Internet Registry, for example APNIC for Asia Pacific), and the RIRs assign them to organizations.

How many are there? About [80,000 ASes](https://www.cidr-report.org/as2.0/) currently announce routes in the BGP table, and about [120,000 ASNs](https://en.wikipedia.org/wiki/Autonomous_system_(Internet)) have been assigned (holding a number does not mean using it).

## Why cut it up

Scale. Billions of devices worldwide cannot be managed by one routing protocol. Once cut into ASes, each AS picks its own routes inside, using an IGP (Interior Gateway Protocol, for example OSPF), and ASes exchange "who can reach which prefix" with BGP.

Walk one packet through. A home computer connects to 8.8.8.8, and the home ISP is AS 64500. The packet first travels inside AS 64500, from the neighborhood exchange to the regional one and on to the border router facing outward. Which hops it takes is decided by the ISP's own OSPF. The border router's BGP table has an entry "8.8.8.0/24 via AS 15169", announced by Google over BGP and learned by the ISP from its neighbors. Once the packet is handed to Google's border router, how Google routes it internally to that DNS server is nothing the ISP knows or needs to know. Along the whole path, BGP looks only at AS numbers and prefixes, never at which machine is inside.

## An analogy

An AS is like a country. Domestic traffic is managed at home (rail, highways = IGP). International flights rely on aviation agreements (= BGP). How to ride the Shinkansen inside Japan is nothing the United States needs to know.

## References

- [Wikipedia: Autonomous system (Internet)](https://en.wikipedia.org/wiki/Autonomous_system_(Internet)) — number of assigned ASNs (about 120,000 in 2025)
- [CIDR Report](https://www.cidr-report.org/as2.0/) — number of announcing ASes
