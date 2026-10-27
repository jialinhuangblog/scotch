---
title: "One HAProxy, one config line: from L4 to L7"
slug: lb-l4-l7-lab
subtitle: "mode tcp only hands connections out in turn; mode http can read the URL. Spreading gRPC streams and the traffic ratio of a canary deploy both need mode http."
chapter: "networking"
tags: [load-balancer, haproxy, nginx, l4, l7, grpc, canary]
date: 2026-07-20
updated: 2026-10-17
revisions: 1
related: [network-devices-by-layer]
---

# One HAProxy, one config line: from L4 to L7

An L4 and an L7 load balancer can be the same HAProxy. Changing one line of config switches between them.

## What L4 and L7 can read

An [L4 load balancer](chunk://l4-vs-l7-lb) works at [TCP](chunk://tcp)/UDP. It can read the IP, the port and the connection state, but not the payload. It decides per connection, so every packet of one connection goes to the same backend. Because it does not parse headers or buffer the body, NAT level forwarding (AWS NLB, Linux IPVS) handles millions of connections per second. HAProxy TCP mode is L4 too, but as a user-space proxy it terminates TCP and opens a new connection behind it, so it is not in that throughput class.

An L7 load balancer terminates the connection and reads the application layer protocol, so it can read the URL, headers and cookies. It decides per request, so different requests on the same HTTP/2 connection can go to different backends. AWS ALB, Nginx, Envoy and HAProxy HTTP mode all belong to this kind.

## Testing L4: mode tcp

Run two Express servers locally, same code, different ports:

```bash
PORT=1234 node app.js   # server 1
PORT=5678 node app.js   # server 2
```

HAProxy config (tcp.cfg):

```text
defaults
    mode tcp

frontend localnodes
    bind *:80
    default_backend nodes

backend nodes
    server server1 127.0.0.1:1234 check
    server server2 127.0.0.1:5678 check
```

Under `mode tcp` HAProxy does not read the HTTP content. It only hands the TCP connections out in turn. curl a few times and the two servers answer in turn:

```bash
$ curl localhost
<h1>listening at port 1234</h1>
$ curl localhost
<h1>listening at port 5678</h1>
$ curl localhost
<h1>listening at port 1234</h1>
```

This is the same as a switch forwarding frames: it does not look at the content, it hands them out by rule.

## Testing L7: mode http

This time there are two different services, each with two instances:

```bash
PORT=1111 node my-first-service.js    # first-service instance 1
PORT=2222 node my-first-service.js    # first-service instance 2
PORT=3333 node my-second-service.js   # second-service instance 1
PORT=4444 node my-second-service.js   # second-service instance 2
```

HAProxy config (http.cfg):

```text
defaults
    mode http

frontend localnodes
    bind *:9999
    acl app1 path_end -i /first-service
    acl app2 path_end -i /second-service
    use_backend first_service_servers if app1
    use_backend second_service_servers if app2

backend first_service_servers
    server s1 127.0.0.1:1111 check
    server s2 127.0.0.1:2222 check

backend second_service_servers
    server s1 127.0.0.1:3333 check
    server s2 127.0.0.1:4444 check
```

Under `mode http` HAProxy reads the URL path and routes to a different backend group by `/first-service` or `/second-service`. Inside each group it still round-robins:

```bash
$ curl localhost:9999/first-service
<h1>First service at 1111</h1>
$ curl localhost:9999/first-service
<h1>First service at 2222</h1>
$ curl localhost:9999/second-service
<h1>Second service at 3333</h1>
```

Both runs use the same HAProxy. The only difference is `mode tcp` versus `mode http`. HTTP mode unpacks one more layer and can read the URL, which is what makes a rule like "route to a service by path" possible. The [previous article](article://network-devices-by-layer) said that how many layers a device unpacks decides what kind of device it is. These two curl runs are a concrete example.

In practice you do not need two configs. One `haproxy.cfg` defines a TCP frontend and an HTTP frontend at the same time, each bound to a different port, and one process handles both modes.

## HAProxy vs Nginx

| | HAProxy | Nginx |
|---|---|---|
| Role | dedicated load balancer | web server + reverse proxy |
| L4 TCP | its strength | can do it, but not its focus |
| L7 HTTP | can do it | its strength |
| Static files | no | serves HTML/CSS/JS directly |
| Health check | built in, fine grained | basic |

Nginx is a "web server plus [reverse proxy](chunk://reverse-proxy)". It can serve a static site and also proxy. HAProxy is a "dedicated load balancer". It serves no content and only distributes traffic. Many architectures use both: Nginx for TLS termination and static files, HAProxy for L4/L7 load balancing.

## Why spreading gRPC streams and canary deploys need L7

[gRPC](chunk://grpc-http2) runs only on HTTP/2, and one TCP connection carries dozens of streams. L4 only knows connections. It does not know how many streams are inside, so the whole connection goes to one backend, and the other machines sit idle with no traffic. Spreading by stream needs L7.

A [canary deploy](chunk://canary-deploy) sends only a small share of traffic, say 5%, to the new version when it goes live, then grows the share once it looks fine. To carve out that 5%, L7 can decide per request which version it goes to. L4 can only switch a whole connection at a time, so the ratio follows the connection count and an exact percentage is not possible.

## L4 on the outside, L7 on the inside

The situation is a startup running its own k8s. Its services grew from three to fifteen, internal calls moved to gRPC one by one, and the entrance is still one nginx doing everything.

One nginx (L7) doing everything is fine while traffic is small. Once traffic grows, the first move is to switch the entrance to L4 (NLB or HAProxy TCP mode), because the outer layer needs throughput and TLS passthrough and does not need to understand the content. Some time later, internal gRPC calls multiply, and the team finds that long connections concentrate traffic on a few pods. Only then is L7 (Envoy, ALB) added on the inside, to spread the streams of one connection across different pods. The usual end shape is two layers: L4 outside, L7 inside.

Two things make a team regret this two layer setup. The first is the cost of the inner L7. Every request has to be terminated, parsed and sent on over a rebuilt connection, so CPU and latency rise noticeably. Where TLS terminates also has to be rethought: L4 passthrough straight into the pod, or L7 termination with the internal network moved to mTLS (mutual TLS, both ends present a certificate). The second is when the routing rules of the two layers start to repeat, or even contradict each other. That is the point to converge on a [service mesh](chunk://service-mesh) or the Gateway API.

---

The following articles on [packets](article://packet-journey), [DNS](article://dns-journey), [routing](article://routing-journey) and [security](article://security-journey) follow the path one packet takes and look at how many layers each device along the way unpacks.
