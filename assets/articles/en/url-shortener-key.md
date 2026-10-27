---
title: "Short link keys: what goes wrong with hash, counter and Snowflake"
slug: url-shortener-key
subtitle: "A truncated hash collides, a counter can be enumerated, a Snowflake key is too long. In practice the common choice is a counter, plus a layer of bit shuffling or encryption so nobody outside can guess the next key."
chapter: "url-shortener"
tags: [url-shortener, hashing, base62, unique-id, bloom-filter]
date: 2026-03-21
updated: 2026-10-17
revisions: 1
related: [url-shortener-store, url-shortener-read, url-shortener-demo]
---

# Short link keys: what goes wrong with hash, counter and Snowflake

Given a long URL, return a short URL. Clicking the short URL redirects back to the original long URL. This article solves one piece: how a long URL becomes a 7 character short key.

---

## How many years do 7 characters last

The short URL format is `https://short.url/<key>`. The key uses a-z, A-Z and 0-9 (base62), 7 characters.

```text
62^7 = 3,521,614,606,208 ≈ 3.5 trillion combinations
```

For scale: a service at Bitly's level shortens hundreds of millions of URLs a month and generates over ten billion clicks. The math below uses a mid-sized load, say 1 million a day.

```text
1 million a day: 3.5 trillion ÷ 1 million ÷ 365 ≈ 9,600 years
20 million a day (Bitly level): 3.5 trillion ÷ 20 million ÷ 365 ≈ 480 years
```

Even at Bitly's volume, 7 characters last a few hundred years.

What about 6? 62^6 ≈ 56.8 billion. At 20 million a day that lasts only 7.8 years. Not enough margin, so 7 it is.

---

## Method one: hash the URL

The most direct approach is to run the long URL through a hash function and take the first 7 characters.

```text
MD5("https://example.com/very/long/path")
= "bab0087156708cf874ea253a83b8fd5c"

first 7 hex → "bab0087"
```

### The problem: truncation always collides

MD5 outputs 128 bits. 7 hex characters keep only 28 bits (268 million values). As the math below shows, somewhere past ten thousand entries the chance of a collision is already close to one half. SHA-256 is no better, because the output gets truncated either way.

Switching to 7 base62 characters (3.5 trillion values) pushes the collision much later, but it still comes. The reason is the birthday paradox: the space does not have to fill up before a collision. The collision arrives far earlier than intuition expects.

The birthday paradox derivation: how many people in a room before two share a birthday? Compute the chance that everyone has a different day:

```text
person 1: 365/365
person 2: 364/365 (avoid 1 day)
person 3: 363/365 (avoid 2 days)
...
person 23: 343/365 (avoid 22 days)

nobody collides = 365/365 × 364/365 × ... × 343/365 ≈ 0.493
at least one collision = 1 - 0.493 = 50.7%
```

23 people in a space of 365 days, and it is already over 50%. Each extra person is not one more comparison. It is a comparison against everyone before. 23 people make 253 pairs (k×(k-1)/2).

Applied to a hash space: the approximation is that at k ≈ √N the collision probability is about 40% (1 − e^(−1/2)); 50% needs k ≈ 1.18√N.

```text
N = 268 million (7 hex)     → k ≈ 16,000 entries for a 40% collision, 19,000 for 50%
N = 3.5 trillion (7 base62) → k ≈ 1.87 million entries for a 40% collision, 2.2 million for 50%
```

For a Bitly level service (20 million a day), 1.87 million entries is a matter of hours.

### Handling a collision

```text
hash("https://example.com/a") = "Xk9mP2q"
hash("https://example.com/b") = "Xk9mP2q"  ← collision

→ append a salt to the URL and hash again
hash("https://example.com/b" + "1") = "Rn3vL8w"  ← no collision
```

A salt is an extra string appended to the original input, which makes the hash output completely different. That is a property of hash functions: change one character of the input and the whole output changes (avalanche effect). The simplest salt here is an increasing number. On a collision, append `"1"` and hash again. On another, append `"2"`. One or two tries usually settle it.

The word salt comes from cryptography: passwords are stored as hash(password + random_salt), so two people with the same password still get different hashes in the DB. A URL shortener does not need a random salt. It only needs "different from last time" so the hash output changes.

Every create has to query the DB first: does this key exist? If it does, compare the long_url stored in the DB with the one in this request. Same URL: return it directly (not a collision, a repeated request). Different URL: a real collision, so add a salt and retry. In the worst case this retries several times.

### The same URL always hashes to the same key

The same long URL always produces the same hash. This is called natural deduplication. There is no need for an extra DB lookup to ask "has this URL been shortened before", because the same input always gives the same output.

But in practice most URL shorteners need **a separate key per user**, even for the same URL. Each user wants their own analytics:

```text
user A shortens https://example.com/sale → short.url/Xk9mP2q → A sees 500 clicks
user B shortens https://example.com/sale → short.url/Rn3vL8w → B sees 30 clicks
```

With a shared key the click counts mix together, and nobody can tell which traffic A brought in. Bitly creates a separate Bitlink per user. In that scenario natural dedup becomes a limitation, and the fix is to add user_id to the hash input to break it: `hash(url + user_id)`.

The only case where users need not be separated is a pure public tool (like early TinyURL): no accounts, no analytics, shortening only. But today almost no URL shortener skips analytics.

---

## Method two: global counter plus base62

A counter is a number generator that only goes up. Each time someone shortens a URL, the counter adds 1 and hands out a number. Unlike a hash, the counter never looks at the URL content. It only hands out tickets. Convert the number to base62 (write it with the 62 symbols a-z, A-Z, 0-9, the same idea as converting decimal to hex) and that is the short key.

```text
counter = 1            → base62 → "1"
counter = 62           → base62 → "10"
counter = 1,000,000    → base62 → "4c92"
counter = 3,521,614,606,207 → base62 → "ZZZZZZZ" (the 7 digit ceiling)
```

The symbol order here is 0-9, a-z, A-Z, so 0 is the smallest and Z the largest.

Why base62 and not decimal: with the same 7 characters, decimal has only 10^7 = 10 million values, base62 has 62^7 = 3.5 trillion. Far more room, and shorter keys.

Every number is unique, so nothing collides. The most common recommendation in practice is the counter, because it guarantees no collision and needs no DB check.

### Problem one: predictable

If the newest short URL is `short.url/4c92`, then `4c91` and `4c93` exist too. An attacker can walk through every short URL and collect every URL anyone has shortened.

This is not unique to URL shorteners. Most APIs reach resources by ID (`GET /users/:id`), and exposing the ID cannot be avoided. The question is what someone can work out from it once it is exposed.

| | Auto-increment / BIGSERIAL | UUID v4 / v7 / Snowflake |
|---|---|---|
| Enumerable | try `/users/1` through `/users/9999` | UUID is a 128-bit space, the chance of a guess landing is near zero; Snowflake is 64-bit with a timestamp prefix, so neighbours are guessable |
| Leaks scale | `/users/58000` → about 58,000 users | the total cannot be inferred |
| Leaks order | `id=100` was created after `id=50` | UUID v4 has no order at all. UUIDv7/Snowflake start with a timestamp, but reading it requires knowing the format |

Even with permission checks, auto-increment still lets an attacker learn "this ID exists, I just lack access". With a UUID, not even the existence of an ID can be guessed.

### Problem two: single point of failure

Where does the counter live? On one machine? If it goes down, no new URL can be created.

The DB's auto-increment? Then every write goes to the same DB for a number, and that DB becomes the bottleneck.

### Handing out number ranges

One counter service owns the numbers. Application servers come to claim a range:

```text
Server A claims [1, 10000]        → adds 1 by itself inside this range
Server B claims [10001, 20000]    → adds 1 by itself inside this range
Server C claims [20001, 30000]    → ...
```

Each server counts up inside its own range and claims a new one when it runs out. The counter service is not called on every request, only when a range is used up. Far less load.

But the counter service is still a single point of failure. If it is down, nobody can claim a range. It needs HA: store the counter's current value ("where the next range starts") in etcd or ZooKeeper. Both are multi-node systems that keep data consistent with a consensus protocol (Raft / ZAB), so one node can fail and the others keep serving. After a restart, the counter service reads the latest value back from etcd and continues handing out numbers.

---

## Method three: Snowflake-like ID plus base62

Generate a 64-bit integer the Snowflake way (timestamp + machine ID + sequence), then convert it to base62.

```text
Snowflake ID = 1800000000000000000
→ base62 → "28Y1bpg4Wl2" (11 characters)
```

Each machine generates its own IDs without collisions, and the IDs carry time order.

### The problem: the key is too long

A few 64-bit integers converted to base62:

```text
7183294852610          → base62 → "22sT39qW"     (8 characters)
9999999999999999       → base62 → "JNBBGsgR9"    (9 characters)
max 64-bit: 2^63 - 1   → base62 → "aZl8N0y58M7"  (11 characters)
```

Base62 works like decimal: a bigger number takes more characters. A counter starts at 1 and grows slowly, so early keys are short. Snowflake is different. The timestamp sits in the highest bits, and it counts milliseconds since an epoch. With Twitter's epoch (2010), after shifting the timestamp left by 22 bits, today's IDs are already around 1.8×10¹⁸, so they start at 11 characters.

Cut it to 7 characters and the collision problem is back. Fitting it into 7 is hard anyway: 7 base62 characters hold about 41.7 bits, and Snowflake's timestamp alone takes 41. The timestamp, machine ID and sequence would all have to shrink a lot, and the usable years and machine count shrink with them.

---

## 301 vs 302

The user clicks the short URL, and the server has to send them to the original long URL. This "sending" is an HTTP redirect: the server returns a 3xx status code that points the browser at another URL.

```text
user's browser → GET short.url/Xk9mP2q
Server         ← 302 Found, Location: https://example.com/very/long/path
user's browser → GET https://example.com/very/long/path (automatic jump)
```

301 and 302 are both redirects, but the browser handles them differently after receiving one:

```text
301 Moved Permanently → the browser remembers; the next click on the same short URL skips the server and jumps directly
302 Found             → the browser does not remember; every click asks the server
```

301 saves the server work. But the server never sees the later clicks, and click analytics stop.

302 passes through the server every time. Every click can be recorded. It costs one more round trip, but for a URL shortener, knowing about every click matters more than saving traffic.

Most URL shorteners use 302.

---

## The three methods side by side

| | Truncated hash | Counter + Base62 | Snowflake + Base62 |
|---|---|---|---|
| Collision | collides after truncation | never | never, unless truncated |
| Predictable | no | yes (sequential) | partly (the timestamp can be inferred) |
| Distributed | by nature | needs a counter service | by nature |
| Key length | fixed | grows with the counter | grows with the ID |
| Dedup | natural (same URL, same hash) | none | none |

---

## Common follow-up questions

---

> **"The same long URL comes in twice. Should it return the same short key?"**
>
> This is a business decision, not a technical one.
>
> If different users shortening the same URL share one key, the click counts mix together and nobody can tell whose traffic is whose. Bitly creates a separate Bitlink per user, even for the same target URL. That is the mainstream approach, because almost every URL shortener offers per-user analytics.
>
> The only scenario that returns the same key is a pure public tool (no accounts, no analytics). It saves space, but that kind of service hardly exists any more.

---

> **"Counter keys can be enumerated. How do you prevent it?"**
>
> Keys from a counter are sequential: `4c91`, `4c92`, `4c93`. Know one and you can guess all the ones before and after. The fix: the counter's number is only an internal ID, never the short key itself. A conversion layer in between makes the key the outside sees unpredictable.
>
> ```text
> internal ID (predictable)  →  convert  →  external key (unpredictable)
> counter = 1000001          →           → "Rn3vL8w"
> counter = 1000002          →           → "Xk9mP2q"
> counter = 1000003          →           → "Qp7kN4x"
> ```
>
> Two conversions are common: bit shuffling and encryption. Both are bijective functions: every input maps to exactly one output, and every output comes from exactly one input. No two IDs become the same key (no collision), and the ID can be recovered from the key (reversible).
>
> ```text
> bijective:       1→a  2→b  3→c    no collision, reversible
> non-bijective:   1→a  2→a  3→c    collision, 1 and 2 both become a
> ```
>
> **The simple version: bit shuffling.** Rearrange the binary bits of the ID by a fixed rule. Like shuffling a deck of cards in the same order every time, so the same input always gives the same output.
>
> ```text
> ID = 5 in binary:            0 1 0 1
> rule: swap bit 1 and bit 4
> result:                      1 1 0 0 = 12
>
> ID = 6 in binary:            0 1 1 0
> same rule:                   0 1 1 0 = 6 (unchanged by chance)
> ```
>
> The numbers the outside sees are no longer sequential, but anyone who knows the shuffle rule can reverse it. This is not encryption, only scrambling.
>
> **The secure version: AES encryption.** The server holds a secret key (a random 128-bit string), encrypts the counter ID with AES, gets a number that looks completely random, and converts that to base62.
>
> ```text
> AES(secret_key, 1000001) = 82719364 → base62 → "Rn3vL8w"
> AES(secret_key, 1000002) = 50183927 → base62 → "Xk9mP2q"
> AES_decrypt(secret_key, 82719364) = 1000001 ← reversible
> ```
>
> An attacker who sees `Rn3vL8w` and `Xk9mP2q` cannot work out the next one without the secret key, and cannot tell that these two are consecutive IDs. The difference from bit shuffling: a shuffle rule can be guessed and then broken, while a 128-bit AES key cannot be brute forced.
>
> The numbers above are illustrative. An AES block is fixed at 128 bits, so encrypting a counter directly gives a 128-bit output, which is about 22 characters in base62, not 7. To keep the output within 7 characters, practice uses format-preserving encryption (FPE, for example NIST's FF1), where the output falls in the same numeric range as the input.

---

> **"The counter service is down. Can the running servers still make keys?"**
>
> Yes. Because of the range mechanism, every server has already claimed a range (say `[30001, 40000]`). When the counter service goes down, the server still has unused numbers left and keeps handing them out.
>
> ```text
> The counter service's whole logic:
>   someone claims → give them next_start → next_start += 10000
>
> There is one copy of next_start, in the counter service (backed by etcd/ZooKeeper), shared by every server.
> Claiming a range must be atomic (compare-and-swap): two servers claim at once, one wins, the other retries.
> ```
>
> Edge cases:
> - **Range used up?** No new range can be claimed, so return 503 and ask the client to retry later (graceful degradation). Redirects (reads) keep working; only creating new short URLs pauses.
> - **Gaps?** Server A claimed `[30001, 40000]`, used up to 35000, then restarted. 35001-40000 are never used. After the counter service recovers it continues from next_start, leaving a gap. But a gap only wastes numbers, and wasting a few thousand out of 3.5 trillion does not matter.
> - **How does it continue after recovery?** next_start lives in etcd/ZooKeeper. After a restart it reads the value back and knows where to continue.

---

> **"The hash method needs a DB check for collisions on every create. At ten thousand creates a second, can the DB keep up?"**
>
> Put a Bloom filter in front of the DB (details in the [bloom-filter](chunk://bloom-filter) chunk). Ask the Bloom filter first. "Definitely does not exist" means use the key directly, no DB lookup. Most new keys do not collide, and only the rare false positive actually reaches the DB. Out of 10,000 QPS, maybe a few dozen land on the DB.
>
> An in-process Bloom filter lives in RAM, and one lookup takes tens of nanoseconds. A DB query goes through SSD and network, more than 10,000 times slower. At startup, load every existing key from the DB into the Bloom filter, and add each new key as it is created. With RedisBloom it persists together with Redis, so a restart needs no rebuild, at the cost of a network round trip per lookup.

---

> **"How do custom aliases (a user's own short key, such as `short.url/my-brand`) coexist with system generated keys?"**
>
> Make the two key formats non-overlapping at the source, and a collision becomes impossible:
>
> ```text
> system generated: pure base62 ("Xk9mP2q")
> user custom: must contain a hyphen ("my-brand") or have a different length
> → different formats, no collision possible
> ```
>
> When a user requests a custom alias, check the DB and refuse if it is taken ("already in use, please pick another"). Same as claiming a username, and users accept that experience.
>
> If the follow-up is "custom alias was added after launch": leave old keys alone, refuse a new custom alias that collides with an old key, and change the format of future system keys so they cannot collide with the custom format.

---

> **"If the same long URL is sent twice with the same idempotency key, what should the second request return?"**
>
> When the second request arrives, the first may already be finished or may still be in progress (details in the [idempotency](chunk://idempotency) chunk):
>
> ```text
> finished: the result for this idempotency key is already stored
>   → return the previous result (201 + "Xk9mP2q"), do not create a new one
>   → from the client's view, the response is identical to the first
>
> in progress: the same key is still executing, not yet done
>   → return 409 Conflict (the request conflicts with current state) and ask the client to retry later
>   → not 429 (429 is the rate limiter rejecting requests that come too often, a different meaning)
> ```

---

## What if X is not available

Interviewers take away a tool and ask what you do without it.

---

> **"ZooKeeper / etcd cannot be used for the counter. How do you hand out ranges?"**
>
> Use the DB itself as the counter service. One table stores `next_start`, and claiming a range is one `UPDATE`:
>
> ```sql
> UPDATE counter_table
> SET next_start = next_start + 10000
> RETURNING next_start;
> -- returns the updated 40001, so this claim gets the range [30001, 40000]
> ```
>
> The DB's `UPDATE` serializes concurrent calls through the row lock on that one row (the I in ACID), and `RETURNING` brings the new value back in the same round trip, so no extra compare-and-swap is needed.
>
> The value of ZooKeeper / etcd is multi-replica high availability. But a DB has replication too (leader-follower), and with Aurora there is even less to worry about: 3 AZs with 2 copies each, 6 in total. When the writer dies it fails over automatically (~30 seconds), a read replica is promoted directly, with no election and no data copy. Any storage with ACID plus high availability can serve as the counter service, and the DB is the one already there.

---

> **"Bloom filter cannot be used. How do you check quickly that a key is unique?"**
>
> Go back and ask "why is dedup needed". With the counter approach every number is unique by construction, so no dedup mechanism is needed at all.

---

> **"No external service at all (no Redis, no ZooKeeper, no counter service). How do multiple servers make unique keys?"**
>
> Each machine is its own isolated space. Use the machine ID as a prefix, and each server counts up locally, with no external service to coordinate.
>
> ```text
> Server A (machine_id = 01): 01-00001, 01-00002, 01-00003
> Server B (machine_id = 02): 02-00001, 02-00002, 02-00003
> Server C (machine_id = 03): 03-00001, 03-00002, 03-00003
> ```
>
> Different prefixes cannot collide. Snowflake's machine ID field uses the same principle (Snowflake also adds a timestamp and a sequence), and you can implement it yourself without a Snowflake library.

---

## Where the keys go after they are made

Where these key-value pairs (short key → long URL) live once there are many of them is the topic of the [next article](article://url-shortener-store).

---

## References

- [Bitly: over 10 billion link clicks and scans per month (official press release)](https://bitly.com/pages/resources/press/bitly-wraps-2022-surpassing-100m-in-arr-and-over-500k-global-customers/)
