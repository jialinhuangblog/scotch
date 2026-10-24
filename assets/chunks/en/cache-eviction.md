---
title: "Cache Eviction"
slug: cache-eviction
brief: "LRU, LFU, TTL. Memory is limited, so who gets kicked out?"
date: 2026-06-12
updated: 2026-10-18
revisions: 2
---

# Cache Eviction

> The cache is full and new data needs to come in. Which entry gets kicked out?

## Eviction policy

The cache lives in memory and space is limited. When it is full, one entry has to be dropped. The rule for picking that entry is the eviction policy. If the dropped key is one that will be read again right away, that read misses and goes back to the DB.

Walk through a cache that holds only 3 entries. Read products A, B and C in that order, and it is full. Then read A once more, then read D. D needs a slot, so one entry has to go.

- **LRU (Least Recently Used)**: drop the entry untouched for the longest. A was just read, B is the one untouched the longest, so B goes. It bets that "what was used recently will be used again soon". The most common.
- **LFU (Least Frequently Used)**: drop the entry used the fewest times. A has 2 reads, B and C have 1 each, and between B and C the older one goes, so B again. The cache now holds A(2), C(1), D(1), and D, having just arrived, starts at 1. Then C is read once more and goes to 2. Then E needs a slot, and the only lowest count is D, so D goes. If D is a product that just started trending, the next read of D misses, D comes back with a count of 1 again, and at the next eviction it is the lowest once more. It bets that "popular stays popular", which works against a key that has only just become hot.
- **TTL / expiry**: each entry gets a time to live, say 60 seconds, and is cleared when it expires, full or not.
- **FIFO / random**: first in first out drops A, because A entered first, regardless of the read it just got; random is luck. Simple, but blind to hot and cold.

Like a small fridge: when nothing more fits, throw out the box that has sat untouched the longest (LRU).

## A large scan lowers the LRU hit rate

The same 3 entry cache normally holds A, B and C, three popular products, with a high hit rate. Then a reporting job reads all 10,000 products on the site from start to end, each exactly once. To LRU every new key counts as "recently used", so A, B and C are replaced by the first three scanned keys, and every read after that misses. When the report finishes and normal users come back for A, it still misses and goes to the DB. So in practice a mix of LRU and LFU is common. Both designs below let the scanned keys into the cache. They only keep them out of the part that holds the popular data.

ARC splits the cache into two LRU lists. A key read only once goes into T1, and a key read twice or more moves up to T2. Each of the 10,000 keys the report scans is read once, so they only rotate through T1, while A, B and C have long been in T2 and are not replaced. W-TinyLFU (the policy Caffeine uses) puts a new key into a small LRU window first. When a key is pushed out of the window, its read count is compared with the entry in the main area that would be replaced next, and the one with the lower count is dropped. Every scanned key has been read once, a lower count than A, B and C, so none of them gets into the main area.
