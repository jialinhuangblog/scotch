---
title: "DataLoader Batching"
slug: dataloader
brief: "Every .load(id) queued in the same event loop turn piles into one batch, dispatched at the boundary as a single IN query. The GraphQL fix for N+1."
date: 2026-04-28
updated: 2026-07-20
revisions: 3
article: wishlist-dataloader
---

# DataLoader Batching

> The natural way to write a GraphQL resolver is one `.load(id)` at a time. How do those calls merge into one DB query on their own?

## The scene: N+1

```graphql
{ posts { author { name } } }
```

20 posts each run the author resolver once, and each one is written like this:

```ts
const author = await db.query('SELECT * FROM users WHERE id = ?', post.author_id);
```

The classic [N+1](chunk://n-plus-1) case: 20 round trips, because no resolver knows the other resolvers are also querying users.

## How to use it

The resolver code does not change. DataLoader merges the `.load()` calls underneath:

```ts
const userLoader = new DataLoader(async (ids) => {
  const users = await db.query('SELECT * FROM users WHERE id IN (?)', [ids]);
  const map = new Map(users.map(u => [u.id, u]));
  return ids.map(id => map.get(id) ?? null);
});

// inside the resolver, still called one at a time:
const author = await ctx.userLoader.load(post.author_id);
```

20 resolvers each call `.load(id)`, and only 1 DB query actually goes out.

## The core mechanism

`.load(key)` does not touch the DB. It adds the key to a batch and returns a **pending promise** on the spot (the resolve function is stored in the batch, aligned with the key by index). Then, at the **event loop boundary**, it dispatches once: it calls the batch function you wrote (that `IN` query), and when the DB returns, it fills in each promise by index.

```text
load(101) load(102) … load(120)   ← piled into one batch in the same turn
        ↓ event loop boundary
batchFn([101..120]) → 1 SELECT ... IN (...)
        ↓ DB returns
resolve each .load() promise by index
```

How "the same turn" is defined, how the dispatch moment is decided (the double wrap of `Promise.then` + `process.nextTick`), how the source runs line by line, which event loop phase it lands in, and what it looks like inside NestJS + an ORM: the full breakdown is in the article [21 queries per page from N+1: how DataLoader merges them into one](article://wishlist-dataloader).

## What three ways of writing it lead to

```ts
// ✓ queued synchronously: 100 ids in one batch → 1 query
for (let i = 0; i < 100; i++) loader.load(i);

// ✓ Promise.all: .map calls .load() 100 times synchronously, one batch → 1 query
//   (the official loader.loadMany(ids) is a wrapper around this)
await Promise.all(ids.map(id => loader.load(id)));

// ✗ await inside a sequential loop: each await yields, dispatch fires first, one batch each → 100 queries
for (let i = 0; i < 100; i++) await loader.load(i);
```

The last one is the most common mistake. But the GraphQL resolver pattern of "each field does its own `await load()`" is safe, because the engine calls sibling resolvers concurrently, so the loads land in the same turn and the same batch. What breaks batching (back to N+1) is an await between two `load()` calls, for example a **sequential loop written by hand**.

## Per-request cache

DataLoader ships with a cache. Within one instance, a second `.load(101)` returns the same promise as the first (one query per key per request):

```ts
const a = userLoader.load(101);
const b = userLoader.load(101);
// a === b
```

**Each HTTP request gets its own DataLoader instance.** If one instance is shared across requests, data that user A queried stays in the cache, user B's request gets it directly, and private data leaks.

## How it differs from ORM preloading

| | ORM `include` / `select_related` | DataLoader |
|---|---|---|
| Which layer | DB query level | application level |
| How it is written | declare the join at the start | resolvers keep calling `.load()` |
| Across services | not applicable | across services / DBs / caches |
| With GraphQL | resolvers resolve field by field, no way to join up front | designed for GraphQL |
