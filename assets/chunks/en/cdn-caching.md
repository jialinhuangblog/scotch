---
title: "CDN Caching"
slug: cdn-caching
brief: "Edge caching. Push vs pull. Invalidation propagation delay."
date: 2026-04-07
---

# CDN Caching

The user is in Tokyo, the server is on the US west coast. Every request takes a 150ms round trip. Add a CDN, and the Tokyo edge node has a cache: a 5ms round trip.

A CDN is the large scale version of a read-through cache. When an edge node misses, it fetches the content from the origin and caches it, and the next identical request is answered by the node directly. The application does not need to know the CDN exists.

## Pull vs Push

**Pull CDN**: the first user's request reaches the edge node, misses, and the node fetches the content from the origin and caches it. Later requests hit. This is the default mode for most CDNs.

```text
user → edge node (miss) → origin → edge node (cache) → user
user → edge node (hit) → user
```

Downside: the first user is always slow. Low traffic content may expire before it is requested again, so it has to be fetched from the origin all over again.

**Push CDN**: the origin pushes content to the edge nodes on its own, without waiting for requests. Suited to large static assets (video, firmware), or content you already know will see a traffic spike before release.

Most cases use pull. Push is worth it only when the traffic can be predicted in advance.

## Cache-Control

The CDN reads HTTP headers to decide whether to cache and for how long:

```text
Cache-Control: public, max-age=86400        → CDN caches for 24 hours
Cache-Control: private, no-store             → CDN does not cache (personalized content)
Cache-Control: public, s-maxage=3600         → CDN caches for 1 hour (s-maxage takes priority over max-age)
```

`s-maxage` is for shared caches (the CDN). `max-age` is for the browser. The two can differ: the CDN caches for 1 hour, the browser for 5 minutes.

## Invalidation

Invalidation is the hardest part of a CDN. After the content is updated, how do you clear the old copies on every edge node?

| Method | How | Price |
|---|---|---|
| TTL expiry | wait for max-age to run out and refresh on its own | updates are delayed; stale within the TTL |
| Active purge | call the CDN API to clear a specific URL | takes seconds to minutes to reach every node |
| Versioned URL | `app.v2.js` or `app.abc123.js` | new URL = new cache entry, the old one expires on its own. Cleanest |

A versioned URL is the most reliable method. The hashed filenames a frontend build tool produces (`main.3f2a1b.js`) work on this principle. The HTML itself gets a short TTL or no cache; CSS/JS get a hashed filename plus a long TTL.

## What a CDN cannot handle

- Dynamic API responses (personalized content, real time data)
- POST/PUT/DELETE (write operations)
- Low traffic long tail content (low hit rate; better not to cache)

A CDN solves "the same content read by very many people". If every request gets a different response, a CDN does not help.
