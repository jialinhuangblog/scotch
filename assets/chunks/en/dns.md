---
title: "DNS"
slug: dns
brief: "Name resolution. Also used for load balancing and failover."
article: dns-journey
date: 2026-03-09
updated: 2026-04-08
revisions: 1
---

# DNS

People remember names; machines want addresses. Besides turning names into addresses, DNS also does load balancing, failover, and geographic routing.

## How resolution runs

The client asks for `api.example.com`. The lookup starts from the local cache, goes to the recursive resolver only on a miss, and the resolver asks from the Root downward to the authoritative server:

```
Browser cache → OS cache → Recursive resolver → Root → .com TLD → example.com authoritative server
```

If any layer's cache has the answer, it returns it right away and does not ask the next layer. The TTL decides how long a cache entry lives.

## More than name lookup

**Load balancing.** Return several A records and let the client pick one. Round-robin DNS spreads traffic without a load balancer, but there is no health check and no weighting.

**Failover.** Health-checked DNS (Route 53, Cloudflare) removes unhealthy IPs from the response, but resolvers and clients that have cached the old answer keep it until the TTL expires. With a TTL of 300 seconds, that is up to 5 minutes still pointing at a server that is already down.

**Geographic routing.** Return the IP of the nearest data center based on the resolver's location. CDNs depend heavily on this.

## The cost

**How long to set the TTL is a tradeoff.** A low TTL (30s) switches fast but drives up query volume; a high TTL (3600s) saves queries but recovers slowly after an outage.

**DNS responses are not verified by default.** Cache poisoning can inject fake records. DNSSEC prevents this with signatures, but adoption is still low.

## When it matters

Most service calls start with a DNS lookup. Multi-region failover depends on health-checked DNS. A "zero-downtime migration" assumes the TTL is short enough for the switch to be fast.
