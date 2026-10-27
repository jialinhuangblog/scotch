---
title: "L4 vs L7 Load Balancing"
slug: l4-vs-l7-lb
article: lb-l4-l7-lab
brief: "L4 sees only IP and port and sends a whole connection to one backend; L7 reads the URL and headers, so each request can go to a different backend."
date: 2026-03-09
updated: 2026-07-20
revisions: 3
---

# L4 vs L7 Load Balancing

A load balancer spreads traffic across backends. How much of the traffic it is spreading can it actually read?

## L4: the packet layer

An L4 load balancer works at TCP/UDP. It sees IP, port, and connection state, but not the payload.

```
Client → [L4 LB picks a backend from src IP + port] → Backend
```

L4 decides per connection: every packet of one connection goes to the same backend. It parses no headers and buffers no request body, so it is fast; NAT-level forwarding handles millions of connections per second.

**Examples:** AWS NLB, HAProxy TCP mode, Linux IPVS.

## L7: the request layer

An L7 load balancer terminates the connection and reads the application protocol (HTTP, gRPC), so it sees the URL, headers, cookies, and request body.

```
Client → [L7 LB sees /api/users, routes to user-service] → Backend
```

The decision happens per request, not per connection. On a multiplexed HTTP/2 connection, different requests can go to different backends.

**Examples:** AWS ALB, Nginx, Envoy, HAProxy HTTP mode.

## Same software, two modes

In HAProxy the difference is one config line: `mode tcp` ignores the content and hands out TCP connections in turn; `mode http` reads the URL path and can route `/first-service` and `/second-service` to different backend groups.

## When L4 is not enough

gRPC runs on HTTP/2, with dozens of streams inside one TCP connection. An L4 balancer sees one connection and sends all of it to one backend, so the traffic concentrates on one machine while the others are running but barely used. L4 does not parse the connection, so it has no idea how many streams are inside. L7 parses out the individual streams and can spread them across backends.

gRPC only runs on HTTP/2, so a gRPC service needs an L7 load balancer to get real load balancing. L4 works too, but every request on one connection lands on the same machine, and the traffic is not spread out. On AWS that is ALB (gRPC support since 2020); on k8s it is usually Envoy (the Istio sidecar).

## Weighted canary: another thing only L7 can do

Sending "5% of traffic to the new version" for a canary is also L7 only. L7 handles requests one at a time, so it can decide for each one (say, a 5% chance of going to the new version). L4 can only split whole connections, so it cannot do this.

```yaml
# Istio VirtualService: 95% to stable, 5% to canary
http:
  - route:
      - { destination: { host: app, subset: stable }, weight: 95 }
      - { destination: { host: app, subset: canary }, weight: 5 }
```

Gateway API's HTTPRoute (`weight` on `backendRefs`) and the Nginx Ingress `canary-weight` annotation work the same way. See [Canary](chunk://canary-deploy).

## Comparison

| Aspect | L4 | L7 |
|---|---|---|
| What it sees | IP, port, TCP flags | URL, headers, cookies |
| Decision unit | Per connection | Per request |
| TLS | Usually passed through (can also terminate at the LB) | Terminates; encrypts again if the hop to the backend must be encrypted |
| Performance | High throughput, low latency | More CPU, more memory |
| Routing | IP hash, round-robin | Path-based, header-based, weighted |

## Which one when

Raw throughput, no interest in request content → L4: TCP proxy, database connections, protocols other than HTTP. Routing by content → L7: API gateway, canary deployment, gRPC balancing. Many architectures use both: L4 on the outside for speed, L7 on the inside where the destination depends on content.
