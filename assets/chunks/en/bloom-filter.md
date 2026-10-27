---
title: "Bloom Filter"
slug: bloom-filter
brief: "A bloom filter uses very little memory to answer 'definitely not here'. Misses are answered directly, with no disk lookup."
date: 2026-03-21
updated: 2026-10-17
revisions: 3
---

# Bloom Filter

> Uses very little memory to answer "this key is definitely not here". Used in LSM-trees, CDNs, crawler URL dedup, Chrome Safe Browsing.

## The problem

When an LSM-tree reads one record, it does not know which SSTable holds it. The most direct method is to open every SSTable from newest to oldest and look. 10 SSTables means 10 disk reads. If the record does not exist at all, all 10 are wasted.

Could we ask one question before opening an SSTable: "Could this key possibly be in here?"

## One bit array + a few hash functions

A bloom filter is a bit array of length m, all 0 at the start, paired with k hash functions.

### Add

Run the key through the k hash functions. Each gives a position. Set the bits at those positions to 1.

```text
add "user-42" (k=3, m=10)

hash_1("user-42") = 2
hash_2("user-42") = 5
hash_3("user-42") = 8

index:      0  1  2  3  4  5  6  7  8  9
bit array: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0]
```

Then add "user-77":

```text
hash_1("user-77") = 1
hash_2("user-77") = 5  ← collides with hash_2 of user-42
hash_3("user-77") = 9

index:      0  1  2  3  4  5  6  7  8  9
bit array: [0, 1, 1, 0, 0, 1, 0, 0, 1, 1]
```

### Query

Run the key through the same k hash functions and check whether every corresponding bit is 1.

```text
query "user-42": positions 2, 5, 8 → all 1 → maybe present
query "user-99": positions 3, 5, 7 → position 3 is 0 → definitely absent
```

**Definitely absent**: if any one position is 0, this key was never added.
**Maybe present**: all 1 does not mean it was added. Other keys' hashes may happen to have set all of those positions to 1. This is a false positive.

### No deletion

Set the bits of a key back to 0? No. Those bits may have been set by other keys. Setting them back to 0 gives other keys a false negative (present, but reported absent), which is worse than a false positive.

If you need deletion, use a Counting Bloom Filter: each position stores a counter instead of 0/1. Add is +1, delete is -1. The price is more memory.

## False Positive Rate

The longer the bit array (larger m) and the more hash functions (larger k, up to a limit), the lower the false positive rate.

```text
m = 10 bit per key, k = 7  → false positive rate ≈ 0.8%
m = 5 bit per key, k = 3   → false positive rate ≈ 10%
m = 20 bit per key, k = 14 → false positive rate ≈ 0.01%
```

10 bit per key is a common configuration. 1 million keys need only a 1.2 MB bit array, with a false positive rate under 1%. A hash set holding 1 million keys takes at least tens of MB.

## Why it is fast: RAM vs SSD

The bloom filter sits in RAM. One bloom filter lookup is a memory operation; a DB lookup is disk plus network. The speed gap:

```text
RAM access:   ~100 ns (nanoseconds)
SSD access:   ~100 μs (microseconds) = 1,000x slower
DB query (SSD + network + parsing): ~1-10 ms = 10,000-100,000x slower
```

At 10 bit per key, a bloom filter for 10 million keys takes only 12 MB of RAM, and it removes a large number of unnecessary disk lookups.

## How LSM-trees use it

When each SSTable is built, all the keys it contains go into one bloom filter, stored in the SSTable's metadata.

```text
read key="user-42"
  → check SSTable_5's bloom filter → "definitely absent" → skip
  → check SSTable_4's bloom filter → "definitely absent" → skip
  → check SSTable_3's bloom filter → "maybe present" → open SSTable_3 and look
  → found
```

10 SSTables, the bloom filters skip 8 of them, and only 2 need to be opened. 10 disk IOs become 2.

Cassandra attaches a bloom filter to every SSTable by default. RocksDB supports one per SSTable too, but it is off by default; you have to set `filter_policy`.

## Other uses

**Crawler URL dedup**: crawled URLs go into a bloom filter. A new URL is checked against the bloom filter first, and only "definitely not crawled" goes into the queue. Crawling a page twice once in a while (a false positive) does not affect the result, and it saves a large number of duplicate requests.

**CDN caching policy**: do not cache on the first request (it may be one-time traffic). Use a bloom filter to record the URLs seen, and cache only on the second appearance. Akamai uses this method to keep one-time traffic from polluting the cache.

**Chrome Safe Browsing**: Google maintains a list of malicious URLs. Chrome cannot ask Google every time a page opens. Early Chrome compressed the list into a bloom filter kept locally, and went to the server to confirm only on "maybe malicious". It later switched to a prefix set that takes less space.

## How to use it in practice

Most languages have a ready library. You give it two parameters: how many keys you expect to store (capacity) and the acceptable false positive rate (error_rate). The library computes the bit array size and the number of hash functions.

```python
# Python — pybloom-live
from pybloom_live import BloomFilter

bf = BloomFilter(capacity=10_000_000, error_rate=0.01)

bf.add("Xk9mP2q")

"Xk9mP2q" in bf  # True (maybe present)
"fakeKey" in bf   # False (definitely absent)
```

```text
Common libraries:
  Java:    Google Guava BloomFilter
  Go:      github.com/bits-and-blooms/bloom
  Python:  pybloom-live
  Redis:   RedisBloom module (BF.ADD / BF.EXISTS)
```

**RedisBloom vs plain Redis**: older Redis has no bloom filter. You install the RedisBloom module (a plugin) separately, and only then do commands like `BF.ADD` and `BF.EXISTS` appear. Newer Redis Open Source ships this command set built in. The benefit is that the bloom filter is persisted along with Redis, so a restart does not need to rebuild it from the DB. If Redis does not have these commands, the bloom filter can only live in the application's memory, and a restart loses it. How Redis saves the data in RAM to disk (RDB / AOF) is covered in [Redis Persistence](chunk://redis-persistence).
