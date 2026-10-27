---
title: "From L1 cache to another continent: how long one read takes"
slug: latency-hierarchy
subtitle: "From the CPU L1 cache to an intercontinental RTT, a latency hierarchy spanning 9 orders of magnitude."
chapter: "buffer"
tags: [cache, latency, performance]
date: 2026-05-03
updated: 2026-10-17
revisions: 2
related: [cache-hot-key, db-connections, packet-journey, search-cache]
---

# From L1 cache to another continent: how long one read takes

Read one record from RAM: **100 nanoseconds**.  
Read the same record from SSD: **100 microseconds**.  
Read it from a hard disk: **10 milliseconds**.  
Read it from a server on another continent: **150 milliseconds**.

The same record, and the slowest is about a million times slower than the fastest. The only difference is which layer it lives in.

---

## Time units

Each step is 1000 times:

```
1 second (s)       = 1
1 millisecond (ms) = 10^-3 seconds
1 microsecond (μs) = 10^-6 seconds
1 nanosecond (ns)  = 10^-9 seconds
```

Conversion shortcut:

```
1 second = 1000 milliseconds = 1,000,000 microseconds = 1,000,000,000 nanoseconds
```

Every number below uses these four units. When you see 100 ns, 100 μs, 100 ms, remember they are 1000 times apart, not 100.

---

## The hardware hierarchy

Top to bottom: faster, smaller, more expensive → slower, larger, cheaper.

| Layer | Latency | In seconds | Capacity |
|---|---|---|---|
| CPU register | ~1 ns | 0.000000001 s | a few bytes |
| L1 cache | ~1 ns | 0.000000001 s | 32 KB |
| L2 cache | ~4 ns | 0.000000004 s | 256 KB ~ 1 MB |
| L3 cache | ~10 ns | 0.00000001 s | a few MB ~ tens of MB |
| RAM (DRAM) | ~100 ns | 0.0000001 s | GB scale |
| NVMe SSD | ~100 μs | 0.0001 s | TB scale |
| SATA SSD | ~140 μs | 0.00014 s | TB scale |
| HDD (hard disk) | ~10 ms | 0.01 s | TB scale |

The two SSD rows are the latency of a single 4 KB random read, one request at a time (queue depth 1). Three runs of 20,000 reads each on the NVMe SSD of one Mac gave medians from 93 to 130 μs (script in `bench/nvme-qd1-read/`). [ClickHouse measured with `pread`](https://clickhouse.com/blog/a-journey-to-io_uring-aio-and-modern-storage-devices): a SATA SSD averaged 140 μs, an NVMe SSD was only a little faster on average, and only its p99 was twice as low. Both kinds of SSD use NAND flash and differ only in the interface, so a single read takes about the same time.

**How far apart neighbouring layers are**:

| Comparison | Factor |
|---|---|
| L1 vs RAM | 100 times |
| RAM vs NVMe SSD (~100 μs) | 1,000 times |
| NVMe SSD vs SATA SSD (~140 μs) | less than 2 times |
| SATA SSD vs HDD | about 70 times |
| RAM vs HDD | 100,000 times |

With other conditions roughly the same, a single random read from RAM is about 100,000 times faster than from HDD. NVMe pulls clearly ahead only on large reads: in the same ClickHouse measurement, reading 1 MB took under 1 ms on NVMe and 3 ms on SATA.

---

## The network hierarchy

Reading data across machines, the speed of light is the ceiling:

| Distance | RTT (round trip) | In seconds |
|---|---|---|
| same rack | ~100 μs | 0.0001 s |
| same data center, across racks | ~500 μs | 0.0005 s |
| same city, across data centers | ~5 ms | 0.005 s |
| across cities (same country) | ~30 ms | 0.03 s |
| across continents (Asia ↔ Americas) | ~150 ms | 0.15 s |

**Why an intercontinental round trip starts at about 100 ms**: light in optical fiber travels about 200,000 km per second, only 2/3 of its speed in vacuum (refractive index ~1.45). The great circle distance from Taipei to San Francisco is about 10,400 km, so the round trip is `2 × 10400 ÷ 200000 ≈ 104 ms`. Tokyo to Los Angeles is closer, about 8,800 km, and still takes 88 ms. That is the lower bound with the cable pulled into a straight line. Real submarine cables do not run straight, and routers forward along the way, so measured intercontinental RTT is about 100~180 ms.

"**One RAM access is about a million times faster than one intercontinental network trip**" (100 ns vs 150 ms). So an application spread across regions cannot read the DB on the other side in real time. **It must have a local cache.**

---

## Cache at the application layer

Connect the hardware + network hierarchy to application design, sorted fast to slow:

| Layer | Latency | In seconds | Where |
|---|---|---|---|
| Browser cache | 0 | 0 s | the client |
| App in-process cache (LRU map) | ~100 ns | 0.0000001 s | the program's own memory |
| Redis / Memcached | ~1 ms | 0.001 s | the machine next door, network + RAM |
| Reverse proxy (Varnish, Nginx) | ~1 ms | 0.001 s | the data center entrance |
| DB query cache | ~5 ms | 0.005 s | the DB itself |
| CDN edge node | ~10 ms | 0.01 s | the data center closest to the user |
| DB (read from SSD) | ~10 ms | 0.01 s | the DB machine's disk |
| DB (read from HDD) | ~30 ms | 0.03 s | an old DB |

---

## The full path

The cache hierarchy of one HTTP request:

```
user
  ↓ 50~150 ms (network RTT)
CDN ←───── hit, return (10 ms)
  ↓ miss
Server (same data center)
  ↓ 100 ns (in-process cache)
local RAM ←─ hit, return
  ↓ miss
Redis (another machine)
  ↓ 1 ms
Redis RAM ←── hit, return
  ↓ miss
DB
  ↓ 10 ms (read from SSD)
DB SSD ←── the real data source
```

Each layer **checks itself first and asks the next layer down only on a miss**. Once found, the value is **written back to the layers above**, and the next identical request hits directly.

---

## Why it is designed this way

**The 80/20 rule**: 80% of requests concentrate on 20% of the data, the hot part.

```
hot data (small, frequent) → upper layers (small, fast, expensive)
cold data (large, rare)    → lower layers (large, slow, cheap)
```

Capacity and speed are in conflict by nature:

- The higher the layer, the faster and smaller (L1 is only 32 KB) → room only for the hottest
- The lower the layer, the larger and slower (HDD is routinely TB) → all the data is here

Popular data sits in the front layers, so requests are answered there and do not have to search the back every time.

---

## A real example

"Users worldwide read the same product image. How do you design it?"

```
bad design:
  users worldwide → direct to the US data center DB → read the image
  ↓
  users in Asia wait 150 ms per image

good design:
  images on S3
  S3 + CloudFront (CDN)
  users in Asia → Tokyo edge node (10 ms)
  users in Europe → Frankfurt edge node (10 ms)
  ↓
  latency in every region drops to 10 ms
```

The difference is "**push the data to the layer closest to the user**". A CDN is hot data copied to edge data centers around the world.

---

## The relation to Big-O

On LeetCode, the usual assumption is that all data is in RAM, so only Big-O counts and the constants do not.

In a real system the data is not necessarily in RAM.

- The same O(N), but a random read from RAM versus HDD differs by 100,000 times, and even a sequential scan differs by tens of times
- one cache miss = an extra 100 ns
- To estimate throughput / latency, the first question is **"which layer is the data in"**

Example: "an O(1) hashmap lookup" sounds fast, but if that hashmap is a distributed Redis in another data center, **one lookup is 5 ms**. The same logic in-process is 100 ns. **A 50,000 times difference**, and Big-O cannot show it.

---

## Next

The other articles in the cache series build on this hierarchy:

- **[Cache avalanche / penetration / stampede](article://cache-hot-key)**: why every request reaches the DB when the cache fails
- **[Cache eviction](chunk://cache-eviction)**: when the upper layer is full, who gets kicked out (LRU, LFU)
- **[Cache strategies](chunk://cache-strategies)**: write-through / write-behind / cache-aside, who writes first and who writes after
- **[CDN caching](chunk://cdn-caching)**: how data is pushed to the edge
- **[DB connections](article://db-connections)**: why the DB connection pool needs careful management
- **[Packet journey](article://packet-journey)**: where those 100 ms on the network go

---

## References

- [Latency Numbers Every Programmer Should Know](https://gist.github.com/jboner/2841832): RAM ~100 ns, disk seek ~10 ms, so a single random access from RAM is about 100,000 times faster than from HDD; an intercontinental round trip is ~150 ms, and RAM is about 1.5 million times faster than that (rounded to a million in this article). These compare "latency, single random access". Moving a large block sequentially is about bandwidth, and the gap is far smaller (same source: sequential read of 1 MB, memory 250 μs vs disk 20 ms, about 80 times). The original is a 2012 baseline; the order of magnitude relations still hold.
- [3D XPoint / Intel Optane](https://en.wikipedia.org/wiki/3D_XPoint): for a while there was an extra layer between DRAM and SSD, "persistent memory" (Storage-Class Memory). As a DIMM plugged into a memory slot, Optane had latency only about one order of magnitude above DRAM and kept its data without power, but Intel ended the product line in 2021–2022. Today the new CXL bus is what aims at this layer. An ordinary NVMe SSD sits on PCIe, and its latency stays at the microsecond level, never reaching RAM's nanoseconds.
