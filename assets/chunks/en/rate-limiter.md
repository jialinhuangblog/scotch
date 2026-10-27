---
title: "Rate Limiter"
slug: rate-limiter
brief: "Token bucket allows bursts, sliding window counts strictly. Multiple machines must share one counter."
date: 2026-03-09
updated: 2026-10-17
revisions: 2
article: rate-limiter
---

# Rate Limiter

A rate limiter decides whether to accept this one request from a given client. Bandwidth, CPU, DB connections and API quota are all finite. Without a limit on the heaviest clients, the resource runs out and the normal users are the ones affected.

Two mainstream algorithms, walked through with the same rule: 60 requests per client per minute.

**Token bucket.** Each client gets a bucket with capacity 60, refilled at one token per second. A request takes one token; an empty bucket means 429. A client stays quiet for two minutes, the bucket refills to 60, and then at second 0 it sends 60 requests at once. All of them pass, and only the 61st is rejected. After that one token arrives per second, so one more request passes each second. Counting from second 0, that minute lets through 60 + 59 = 119 requests, about twice what the rule says. A token bucket allows bursts, and the real limit is "60 per minute on average, at most 60 at once". Most APIs use this one, because real users do send a batch of requests at the moment a page opens.

**Sliding window.** Each client keeps the timestamp of every request in the last 60 seconds. When a new request arrives, drop the records older than 60 seconds; if 60 remain, reject it. The same client sends 60 at second 0 and they all pass, but the 61st waits until second 60, when the first record falls out of the window. No 60 second window ever exceeds 60 requests, which suits contracts billed per call, because the number on the invoice matches the rule exactly.

**Multiple machines.** There are 50 app servers, each counting in its own memory. One client sends 3000 requests a minute, spread evenly, so each server sees 60 and every one of them reports the client under the limit, while the total is 50 times over. So the counter has to live somewhere shared, usually Redis, with all 50 servers decrementing the same key.
