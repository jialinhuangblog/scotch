---
title: "Service Mesh"
slug: service-mesh
brief: "Envoy sidecar. mTLS, retries, circuit breaking, with no change to app code."
date: 2026-03-09
updated: 2026-10-18
revisions: 2
---

# Service Mesh

Every microservice needs retry, timeout, mTLS and observability. Either every service writes these itself, or they are handed to the network layer.

## The sidecar model

A proxy (usually Envoy) runs next to each service instance. All traffic passes through it. The application does not know it exists.

```
Service A → Envoy sidecar → network → Envoy sidecar → Service B
```

The sidecar handles TLS termination, retry, circuit breaking and metrics collection. The application only sends HTTP to `localhost`.

## What you get

**mTLS everywhere.** The mesh issues and rotates certificates automatically. Every service-to-service call is encrypted and authenticated. No change to application code.

**Circuit breaking and outlier detection.** Envoy configures these as two separate things. Circuit breaking sets limits: when the connections to Service B, or the requests waiting for a connection, go over the configured number, the extra requests fail at once instead of being sent to B. Outlier detection works on single instances. Say B has 20 instances and one of them returns 5xx five times in a row (the default). The sidecar takes that instance out of the load balancing list and puts it back after 30 seconds; if it fails again, it stays out for 60 seconds, because the time is 30 seconds multiplied by the number of times in a row it was taken out. But at most one tenth of the instances can be out at once, because `max_ejection_percent` defaults to 10%. So if all 20 instances of B start returning 5xx, the default settings take out only 2, and the other 18 keep receiving traffic. To stop traffic when B fails as a whole, raise `max_ejection_percent`, or rely on the circuit breaking limits to make requests fail fast.

**Observability.** Every request passes through the proxy, so metrics (latency, error rate, throughput), distributed tracing headers and access logs are collected automatically, with no instrumentation in application code.

**Traffic control.** Canary deployment, A/B routing, header-based routing. Send 5% of traffic to the new version, and roll back the moment the error rate rises.

## The cost

**Latency.** Each call takes two extra hops (the source sidecar and the destination sidecar), usually 1-3ms in total. Most services never notice such a small delay, but for a service that must respond within milliseconds, that extra 1-3ms is too much.

**Operational complexity.** The mesh itself needs a control plane (Istio, Linkerd), which is one more system to deploy, monitor and debug. Set one policy wrong, and traffic can silently disappear, and it is hard to find out where the problem is.

```yaml
# Istio AuthorizationPolicy, applied to the mesh and placed in front of a service
kind: AuthorizationPolicy
spec:
  action: ALLOW
  rules:
    - from:
        - source:
            principals: ["…/sa/fronend"]   # missing a t, should be frontend
```

As soon as one ALLOW policy exists, anything not listed is rejected. The misspelled frontend does not match, so all of its calls are rejected, but no error shows up on the app side. All you see is traffic dropping for no clear reason, and you have to dig through the sidecar's logs to find it.

**Resource cost.** One Envoy sidecar per pod. 50MB × 1000 pods = 50GB of memory just for proxies.

## When it is worth it

If ten services are all written in Go, retry and timeout go into one shared library, every service imports it, and an upgrade changes one place. Take the same ten services split across Go, Java and Node: the same retry logic has to be written three times and upgraded separately, and each service has to handle its own mTLS certificate rotation. At that point, handing these to the sidecar is less work than maintaining three libraries, even if every pod pays an extra Envoy's worth of memory.
