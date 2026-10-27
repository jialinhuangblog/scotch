---
title: "Reverse Proxy"
slug: reverse-proxy
brief: "Hide the whole fleet of backend servers behind it; the client sees one entry point."
date: 2026-06-12
updated: 2026-10-18
revisions: 2
---

# Reverse Proxy

> There are 50 servers behind. How do you let the client connect to one place only?

## Standing in front of the backend to receive requests

A reverse proxy is one machine standing in front of the group of backend servers. It receives the client's request and forwards it to the right server behind. Nginx, HAProxy and Envoy are the representatives.

Walk through it. The DNS for api.example.com points to 203.0.113.10, which runs Nginx. Behind it, 50 app servers sit on the internal network, 10.0.1.1 to 10.0.1.50, unreachable from outside. The browser sends `GET /orders/42` to 203.0.113.10. Nginx accepts it, picks one server according to its config, say 10.0.1.7, opens its own connection to forward the request, gets the response and returns it to the browser. The browser only ever sees 203.0.113.10 and does not know 10.0.1.7 exists. The next day 10.0.1.7 dies. Open source Nginx does not probe the backends on a schedule. It waits until a real request forwarded to 10.0.1.7 fails to connect or times out. After 1 failure by default, it marks the server as not to be used for the next 10 seconds, and once the 10 seconds pass it sends requests to it again to try. If the failed request was a GET, Nginx passes it to the next server and the browser notices nothing; a POST is not retried by default, so that one request gets an error. Either way, nothing changes in the browser's settings. Probing the backends on a schedule takes the `health_check` of NGINX Plus, or a proxy such as HAProxy whose open source version has active checks.

It is the opposite direction from a forward proxy. A forward proxy connects out to the internet on behalf of the client; the machine at a company's network exit is one. A reverse proxy receives incoming requests on behalf of the server.

Like a company front desk. Every visitor goes to the desk first, and the desk takes them to the right person. The visitor never learns how the office behind is arranged or how many people work there.

## Things done in this one place

Because all traffic passes through it, many functions are most convenient to put here:

- [Load balancing](chunk://l4-vs-l7-lb): the step above that picked 10.0.1.7, by round robin or by fewest connections.
- TLS termination: the certificate is installed only on this Nginx. After it decrypts, the leg to 10.0.1.7 runs over the internal network in plain text or under another layer of encryption, and the 50 app servers do not each manage certificates.
- Routing by path: `/orders` goes to the order service group, `/search` to the search service group.
- Cache, compression, rate limiting, and hiding how many backends there are and what they look like.
