---
title: "The same learning path, applied to frontend system design"
slug: direction-frontend
subtitle: "The same method, on a different machine: the user's browser."
chapter: "extras"
tags: [meta, direction, frontend, radio]
date: 2026-07-03
related: [direction]
---

# The same learning path, applied to frontend system design

The [learning path](article://direction) article covers how to learn the backend. Frontend is the part I know best. The way of learning is the same; the difference is that the code runs in the user's browser. The backend articles trace cause and effect down to the disk and the consensus algorithm. The frontend articles trace it down to the event loop, the render pipeline and the network tab.

## Why a separate article

Compare "design Twitter" with "design the frontend of a notification center".

Backend system design optimizes machines you own. If the DB is not enough, shard it. If there are not enough machines, buy more.

Frontend system design optimizes a machine that is not yours: the user's browser. That machine comes with these limits:

- only one main thread
- you do not know how good the device is
- the network can drop at any moment
- once a cache is sent out, you cannot take it back
- you do not know how many tabs the user has open

## The answer framework: RADIO

Questions of this kind are usually answered in this order:

- **R — Requirements exploration**: narrow the scope. Feature boundaries, scale, offline or not, what is explicitly out.
- **A — Architecture**: the component diagram. View, controller, client store, API layer, and who talks to whom.
- **D — Data model**: how client state is organized. Normalized or nested, server state kept apart from UI state, which layer holds the cache.
- **I — Interface**: the API contract. The schema of each endpoint or [WebSocket](chunk://websocket) event, pagination cursors, error format.
- **O — Optimizations**: go deep. Performance, virtualization, race conditions, a11y, offline.

RADIO does for frontend design questions what STAR does for behavioral questions: it gives the answer a fixed order.

## The question bank: the classic four

One article per question. Under each one sits a root problem, and I have met every one of them in a real project.

| Question | The root problem underneath | Where I met it |
|---|---|---|
| Autocomplete | responses come back out of order. Cancellation, debounce, stale data while the user is still typing | every search box I have ever built |
| Infinite scroll | the DOM cannot keep up with the node count. Virtualization, list windowing, scroll anchoring | kubelens: 820 nodes froze the DOM view and forced a move to WebGL |
| Real-time dashboard | push or pull, reconnecting after a drop, backpressure, how to render while data keeps pouring in | the kubelens rollout status goes over WebSocket |
| Notification center | fan-in, unread counts, consistency across tabs, syncing read state | the blog post who-can-hear-this |

## Primary sources

Read the design documents written by the people who built the system, not tutorials.

### React: RFCs

Every major React feature starts as an RFC (Request for Comments, a public design proposal) that records the motivation, the rejected alternatives and the trade-offs.

- [reactjs/rfcs](https://github.com/reactjs/rfcs)
- The Server Components and Hooks RFCs are worth reading from start to finish: they explain what was missing before the feature existed.

### TanStack Query: a client cache design with readable code

The reference implementation of a cache for server state: staleTime and gcTime, structural sharing, invalidation.

- [TanStack/query](https://github.com/TanStack/query)

### The platform itself

- [HTML spec: event loops](https://html.spec.whatwg.org/multipage/webappapis.html#event-loops): the only authoritative definition of the term "main thread".
- [Fetch spec](https://fetch.spec.whatwg.org): what the browser actually does between `fetch()` and the arrival of bytes.
- [Chrome RenderingNG](https://developer.chrome.com/docs/chromium/renderingng): the real layers of the render pipeline.

## Secondary sources (a dictionary, not a textbook)

| Source | Use |
|---|---|
| [GreatFrontEnd](https://www.greatfrontend.com) | where the RADIO framework comes from, and the most complete question bank for frontend system design |
| [patterns.dev](https://www.patterns.dev) | rendering and component patterns, with diagrams |
| [yangshun/front-end-interview-handbook](https://github.com/yangshun/front-end-interview-handbook) | go through the vocabulary once before going deep |

## The first five

| Order | Article | Why this one first |
|---|---|---|
| 1 | RADIO, and why frontend system design is its own discipline | every other article hangs on this framework |
| 2 | Real-time dashboard | closest to a project I have built (kubelens). Write what I know first, and find what I do not know while writing |
| 3 | Notification center | extend who-can-hear-this from a mechanism into a system |
| 4 | Infinite scroll | tell the full story of the DOM not keeping up with the node count |
| 5 | Autocomplete | smallest on the surface, highest density of race conditions, a good one to end on |
