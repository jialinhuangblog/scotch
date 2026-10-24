---
title: "Distributed Tracing"
slug: distributed-tracing
brief: "Every request gets a trace ID; each service it passes through records spans under it, and afterwards they are joined back into the full path."
date: 2026-06-12
updated: 2026-10-18
revisions: 2
---

# Distributed Tracing

> One request passes through ten microservices. Which one is slow, and how can anyone tell?

## Following one request through every service

A user clicks checkout and the request reaches the gateway. The gateway generates a random trace ID, say `7f3a`, and a span ID for its own part, say `g1`. It writes both into the HTTP header `traceparent` and calls the order service. The order service reads `7f3a` and `g1` from the header, so it knows `g1` called it, and generates its own span ID `o2`. When it calls the inventory service and the payment service, the header carries the same `7f3a` plus its own `o2`. So the trace ID stays the same all the way, and the span ID at each hop is replaced with the caller's. Passed along like this, every service this request touches holds `7f3a` and knows the layer above it. This part is called context propagation.

While each service handles the request, it records one span: the trace ID, its own span ID, the caller's span ID (the parent), its own name, the start time and the end time. The inventory service's span holds `7f3a`, its own ID, and parent `o2`. When done, it sends the span to a backend. Jaeger and Zipkin are the usual ones. OpenTelemetry sits in a different layer: it provides SDKs for each language and a Collector, which create spans and send them to a backend. It stores no data and has no query interface of its own.

Afterwards, look up `7f3a`. The backend pulls every span carrying that trace ID, arranges them into layers by parent (inventory and payment both have parent `o2`, so both go under order), and draws them on a timeline:

```text
gateway          |████████████████████████████████████████| 1200ms
  order          |  ██████████████████████████████████████| 1150ms
    inventory    |    ████                                |   80ms
    payment      |        ████████████████████████████████| 1020ms
```

The order service took 1150ms in total, of which inventory was 80ms and payment was 1020ms. Payment is the slow one. Without a trace, all anyone knows is that checkout takes 1.2 seconds, and the ten services' logs have to be searched one by one.

It is like a parcel tracking number: the parcel is scanned once at every sorting center, and the list shows the station where it got stuck.

## Filling the gap metrics and logs leave

A [metric](chunk://metrics) shows "checkout p99 went from 300ms to 1200ms". A [log](chunk://logging) records "the payment service reported a timeout". But "where exactly did this one slow request get stuck among ten services" is a question only a trace answers. In practice all three work together: the metric finds the problem, the trace finds the segment, and the log shows the details of that segment.

The cost is that every service has to include the SDK and every request sends extra spans. High traffic systems sample, for example recording one request in every hundred.
