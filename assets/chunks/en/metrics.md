---
title: "Metrics"
slug: metrics
brief: "Counter, gauge, histogram. Prometheus pulls, StatsD pushes."
date: 2026-06-12
updated: 2026-10-18
revisions: 2
---

# Metrics

> You want a dashboard showing "current QPS, current p99 latency". Do you dig through the log entry by entry?

## Numbers aggregated over time

A metric does not record every event the way a log does. It is one number, kept in the service's memory and updated as events happen.

Walk through how Prometheus does it. The order service runs on 100 machines. Each one keeps a counter in memory called `http_requests_total` and adds 1 for every request it handles. Every 15 seconds Prometheus goes to each machine's `/metrics` and pulls the current total, say 48,200 at second 0 and 49,700 at second 15. Subtract and divide by 15: this machine averaged 100 requests a second over that window. Add up all 100 machines and that is the QPS on the dashboard. Through all of this Prometheus stores one number per machine every 15 seconds, not one line per request for 1,500 requests.

Three common metric types, which differ in how that number moves:

- **counter**: a running total that only goes up, like `http_requests_total` above. A restart resets it to zero, and Prometheus treats a drop in the number as a restart.
- **gauge**: the value right now, up or down, like memory usage at 1.2GB or 3,400 users online.
- **histogram**: each request's latency is dropped into buckets cut in advance, like 1,400 requests at `≤100ms`, 1,480 at `≤500ms`, 1,500 at `≤1s`. The 99th percent of 1,500 is request number 1,485, which lands in the 500ms to 1s bucket, so p99 is somewhere in that range.

Because they are aggregated, metrics are cheap to store, which suits dashboards, alerts and trends. The four golden signals people watch: latency, traffic, errors, saturation.

Prometheus goes to each service and pulls. With StatsD the service pushes, sending one UDP packet per event to StatsD, which does the aggregating.

Like a car dashboard: speed, fuel and water temperature show the current state at a glance, but cannot tell you how the trip was driven.

## Limits

The buckets above put p99 between 500ms and 1s. Say that from 3:42 pm more requests take over 1s, and p99 moves into the bucket above 1s. The metric can only say "something **is** wrong somewhere", not which request or which service it got stuck in. For that you check the [log](chunk://logging) and the [trace](chunk://distributed-tracing).
