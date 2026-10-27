---
title: "API Gateway"
slug: api-gateway
brief: "A single entrance. Authentication, rate limiting and routing are handled before the application code runs."
date: 2026-04-07
updated: 2026-06-09
revisions: 1
---

# API Gateway

In a microservice architecture, the client should not know how many services sit behind it or where each one lives. The API Gateway is the only entrance. The client talks only to the gateway, and the gateway forwards each request to the right service.

```text
Client → API Gateway → user-service
                     → order-service
                     → payment-service
```

## How it differs from a Load Balancer and a Reverse Proxy

| Role | Layer | What it does | What it looks at |
|---|---|---|---|
| [L4 LB](chunk://l4-vs-l7-lb) | L4 | Splits traffic by connection | IP + port |
| L7 LB | L7 | Splits traffic by content | URL, headers |
| [Reverse Proxy](chunk://reverse-proxy) | L7 | Forwards + hides the backend + TLS termination | HTTP request |
| API Gateway | L7 | All of the above + auth + rate limiting + transformation + monitoring | HTTP + business context |

An L7 LB and a reverse proxy work almost the same way: both read HTTP, both forward by content. An L7 LB stresses spreading traffic evenly across many machines; a reverse proxy stresses being the front door that hides the backend. Nginx and Envoy do both in one process.

A reverse proxy is a subset of a gateway. The gateway adds business-aware features. In practice the line is blurry: Nginx with an auth module and rate limiting already looks like a gateway. But dedicated gateways (Kong, AWS API Gateway) do these more completely.

## What the gateway does

**Authentication**: verifies JWT tokens and API keys. An invalid request is rejected at the gateway and never reaches a backend service.

**[Rate Limiting](chunk://rate-limiter)**: at most 100 requests per user per second; anything over gets a 429, so the backend is not hit with too many requests at once.

**Routing**: `/api/users` → user-service, `/api/orders` → order-service. The client does not need the real address of any service.

**Request/Response transformation**: when the request format the client sends differs from what the service expects, the gateway converts it in the middle. It can also merge responses from several services into one for the client (the BFF pattern).

**Monitoring**: all traffic passes one point. Adding logging, metrics and tracing here takes the least effort.

## The cost

**Single point of failure.** All traffic goes through the gateway. If it is down, the whole system is unavailable. It has to be made highly available (multiple instances + health checks).

**Latency.** One more hop. Authentication, rate limiting and transformation all take time. Usually 1-5ms, but it adds up and becomes noticeable.

**Complexity.** The gateway's routing rules and rate limit policies need maintenance. As teams and rules multiply, the gateway becomes an organizational bottleneck: every routing change has to be coordinated with the gateway team. What is slow is the coordination, not the gateway's performance.

## When you need one

- Microservice architecture, several services need one shared entrance → needed
- A monolith, one service → a reverse proxy is enough, no gateway
- Authentication and rate limiting across services → needed
- Each service handles its own authentication and rate limiting → not needed (but the same work is repeated in every service)

Once there are many services, each handling its own authentication and rate limiting, the same thing gets written several times over. To pull it into a gateway, use an existing product (Kong, AWS API Gateway) or write your own. Writing your own means redoing authentication, rate limiting and monitoring, all of which the existing products already have.
