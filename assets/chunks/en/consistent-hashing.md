---
title: "Consistent Hashing"
slug: consistent-hashing
brief: "Change N in hash(key) % N and almost every key has to move. Consistent hashing moves only about 1/N."
date: 2026-03-19
updated: 2026-10-17
revisions: 4
---

# Consistent Hashing

> A general concept. Cassandra, DynamoDB, Memcached and Nginx all use it to spread data across many machines.

## 3 Redis servers, which one holds product A

An e-commerce site has slow product pages and decides to add a cache. It buys 3 Redis servers, called S0, S1 and S2.

Which one should hold the cache for product A?

### The obvious approach

Hash the product ID and take the remainder by the number of machines.

```text
hash("productA") = 108  →  108 % 3 = 0  →  S0
hash("productB") = 211  →  211 % 3 = 1  →  S1
hash("productC") = 315  →  315 % 3 = 0  →  S0
hash("productD") = 427  →  427 % 3 = 1  →  S1
hash("productE") = 550  →  550 % 3 = 2  →  S2
hash("productF") = 633  →  633 % 3 = 0  →  S0
```

Reads use the same formula, so the client knows which server to read from.

### Traffic spikes on Singles' Day, add a server

S3 comes online. The machine count goes from 3 to 4. The formula becomes `% 4`.

```text
hash("productA") = 108  →  108 % 4 = 0  →  S0 (unchanged)
hash("productB") = 211  →  211 % 4 = 3  →  S3 (was on S1!)
hash("productC") = 315  →  315 % 4 = 3  →  S3 (was on S0!)
hash("productD") = 427  →  427 % 4 = 3  →  S3 (was on S1!)
hash("productE") = 550  →  550 % 4 = 2  →  S2 (unchanged)
hash("productF") = 633  →  633 % 4 = 1  →  S1 (was on S0!)
```

Of 6 products, 4 moved. The data is still in the cache on the old machine, but the formula points to the new one, so the result is a cache miss. All those misses become DB queries, and the DB cannot handle that many requests at once. Adding a machine was meant to share the load; instead the DB gets more traffic.

From 3 machines to 4, on average 75% of keys get reassigned. From 100 to 101, 99%. The more machines there are, the more one added machine costs.

## Bend the line into a ring

Change the denominator in `% N` and every result changes. What if we do not divide by N at all?

Picture the hash range 0 to 999 with its two ends joined into a ring. Each of the 3 machines computes a hash of its own and lands at some position on the ring.

```text
            0
      ┌─────┴─────┐
  S0 (100)         │
      │            │
      │        S1 (400)
      │            │
  S2 (900)         │
      └─────┬─────┘
           600
```

S0 is at position 100, S1 at 400, S2 at 900.

Each product also computes a hash and lands somewhere on the ring. Then walk clockwise; the first server reached is the one responsible for it.

```text
productA hash=250  → walk clockwise → reach S1(400)  → S1
productB hash=500  → walk clockwise → reach S2(900)  → S2
productC hash=950  → walk clockwise → wrap past 0 → reach S0(100)  → S0
```

### Now add S3 at position 300

```text
            0
      ┌─────┴─────┐
  S0 (100)         │
      │            │
  S3 (300) ← new  │
      │        S1 (400)
      │            │
  S2 (900)         │
      └─────┬─────┘
           600
```

S3 sits between S0 and S1. Who is affected?

- Products with a hash between 100 and 300 used to reach S1 going clockwise; now they reach S3 first. These move.
- Every other product reaches the same server as before. No move.

Product A hash=250: before → S1, now → S3. Moves.
Product B hash=500: before → S2, now → S2. Stays.
Product C hash=950: before → S0, now → S0. Stays.

Add one machine, and only the keys on the arc just before S3 need to move. The amount moved drops from 75% to about 1/N.

### What about removing one?

S1 dies. Keys on the arc S1 owned (300~400) no longer find S1 going clockwise; they find the next server, S2. Only the data on S1 needs to move to S2. Everything else stays.

## A new problem: uneven split

Three machines spread evenly around the ring, each owning 1/3 of the arc, is the ideal case.

In reality the hash is random. S0 might land at 100, S1 at 150, S2 at 900. S2 owns the long stretch from 150 to 900, 75% of the keys. S0 and S1 together get only 25%.

```text
S0(100)  S1(150)                              S2(900)
  |--------|------- this whole stretch goes to S2 ------------|
  very short                 very long
```

### How virtual nodes fix it

Do not place just one point. Split each physical server into many "virtual nodes" scattered around the ring.

S0 becomes S0-a, S0-b, S0-c... at 150 different positions on the ring. Same for S1 and S2.

```text
On the ring: S0-a, S1-c, S2-b, S0-d, S2-a, S1-b, S0-c, S1-a, S2-d ...
```

3 physical machines, 150 virtual nodes each, 450 points on the ring. The denser the points, the closer each machine's total arc gets to 1/3.

Why do more points make it even? Think of rolling a die. Roll 3 times and you may get 1, 1, 6, a badly skewed spread. Roll 450 times and the average gets close to 3.5. That is the law of large numbers. With a single point per machine, where that point lands decides how long a stretch it gets. With 150 points scattered everywhere, long and short arcs cancel out, and the total approaches 1/N.

```text
3 points (1 per server):

        0
  ┌─────┴─────┐
S0(100)        │       S0: 900→100 (20%)
S1(150)        │       S1: 100→150 (5%)
  │            │       S2: 150→900 (75%) ← most uneven
S2(900)        │
  └─────┬─────┘

9 points (3 per server):

        0
  ┌─────┴─────┐
S0-a(100)      │       S0's 3 arcs add up to ≈ 33%
  │    S1-a(200)       S1's 3 arcs add up to ≈ 33%
S2-a(300)      │       S2's 3 arcs add up to ≈ 33%
  │    S0-b(450)
S1-b(550)      │       each server is spread over several arcs; long and short cancel out
  │    S2-b(650)
S0-c(750)      │
  │    S1-c(880)
  └─────┬─────┘
```

Cassandra defaulted to 256 virtual nodes per node before 4.0; since 4.0 the default is 16, paired with the new token allocation algorithm.

The virtual node count is also a setting for "what share of traffic each physical machine takes". The more virtual nodes a machine has, the longer its total arc on the ring, and the more keys route to it. So a machine with stronger hardware (more CPU, more RAM) can be given more virtual nodes and carry more keys.
