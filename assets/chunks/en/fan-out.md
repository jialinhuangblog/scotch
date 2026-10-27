---
title: "Fan-out (Push vs Pull)"
slug: fan-out
brief: "Push writes into every follower's feed at post time; pull queries every followed account's posts at read time. Use only one and at scale either the write volume is too large or reads are too slow."
date: 2026-03-21
---

# Fan-out (Push vs Pull)

> One person posts a message and N people have to see it. Push it to everyone when it is posted, or pull it when they look?

## The scenario

A social platform. User A has 500 followers. A publishes a post. The next time those 500 followers open the app, they should see it.

How does A's post show up in 500 people's feeds?

## Fan-out on Write (the push model)

The moment A posts, the system writes the post into every follower's feed.

```text
A posts "hello"
  → write into follower_1's feed
  → write into follower_2's feed
  → ...
  → write into follower_500's feed
```

Each user's feed is a table assembled in advance. Opening the app reads your own feed directly, with nothing to compute.

```text
read feed: SELECT * FROM feed WHERE user_id = 123 ORDER BY time DESC
→ one table, one query. Fast.
```

**Upside**: reads are very fast, the feed is already prepared.

**The cost is on the write side**: A has 500 followers, so one post is 500 writes. A celebrity account has 50 million followers, so one post writes 50 million rows.

```text
ordinary user (500 followers): 500 writes, a few hundred milliseconds, acceptable
celebrity account (50M followers): 50,000,000 writes, possibly several minutes
```

A celebrity posts, and some followers only see it minutes later. And during those minutes the write volume on the message queue spikes, affecting other operations.

## Fan-out on Read (the pull model)

No push at post time. When a user opens the app, the system queries on the spot: "who do I follow? what did they post recently?", then merges and sorts.

```text
user X opens the app:
  → look up who X follows: A, B, C, D, E... (200 people)
  → fetch A's recent posts
  → fetch B's recent posts
  → ...
  → merge, sort, take the top 20
```

**Upside**: a post is written once (into the author's own posts table). A celebrity's post is also one write.

**The cost is on the read side**: every app open queries 200 people's posts and merges them. The more people you follow, the slower the query.

```text
following 200 people: 200 queries + merge sort, maybe 200ms
following 2000 people: 2000 queries + merge sort, maybe 2 seconds
```

And every user computes this on every open. 100 million daily active users means more than 100 million computations a day.

## Why you cannot pick just one

```text
               write volume   read speed   celebrity        ordinary
Fan-out Write  O(followers)   fast         too many writes  just right
Fan-out Read   O(1)           slow         just right       wasteful
```

## The hybrid model

What Twitter (now X) does: push for ordinary users, pull for celebrity accounts.

```text
ordinary user A (500 followers) posts:
  → fan-out on write, push to 500 feeds

celebrity account B (50M followers) posts:
  → write only into B's own posts table, no push

user X opens the app:
  → read X's feed (already holds the posts pushed from ordinary users)
  → separately fetch recent posts from the celebrity accounts X follows
  → merge and sort
```

Once an account's follower count passes a threshold (say 100,000), it switches to the pull model.

Most users' feeds already hold 90% of the content (from fan-out on write) and only need to pull posts from a few celebrity accounts on top. Reads are fast, and a celebrity post does not make the write volume spike.

## The infrastructure behind it

The 500 writes of fan-out on write are not synchronous. They usually go into a message queue (Kafka, SQS) and workers process them asynchronously.

```text
A posts → write posts table → publish an event to the message queue
                                  ↓
                     fan-out worker consumes the event
                     → look up A's follower list
                     → batch write into every follower's feed
```

If the fan-out worker crashes or retries, the writes need to be idempotent: use (user_id, post_id) as a unique key, so a repeated write does not produce a duplicate post.

## Not only social platforms

The fan-out pattern shows up in many places:

- **Notification systems**: one event triggers notifications for N users
- **Live group chat**: one message has to reach everyone in the group
- **E-commerce stock updates**: one SKU drops in price, and every user watching that product gets a push notification

The choice in these cases is the same as for feeds: few receivers, push; many receivers, pull; in practice, mostly a mix of both.

---

Fan-out on write does more work at write time in exchange for fast reads; fan-out on read is the reverse, light writes but reads computed on the spot. In practice the two are mixed: push for ordinary accounts, pull for celebrity accounts.
