---
title: "N+1 Query Problem"
slug: n-plus-1
brief: "Fetch a list, then query the DB once per item, and the query count goes from 1 to 1+N. Very common in ORMs and GraphQL, and hard to notice."
date: 2026-04-28
article: wishlist-dataloader
---

# N+1 Query Problem

## Scene: a list page showing author names

20 blog posts, each needs its author's name. The intuitive way:

```ts
const posts = await db.query('SELECT * FROM posts LIMIT 20');  // 1 query

for (const post of posts) {
  post.author = await db.query(
    'SELECT * FROM users WHERE id = ?', [post.author_id]
  );  // ← one query per post, runs 20 times
}
```

```text
N+1 version:  21 round-trips × 5ms = 105ms
one JOIN:     1 query × 7ms       = 7ms
```

With 100 posts the gap is wider: 1 + 100 vs 1.

## The common ORM problem

```python
# Django
posts = Post.objects.all()  # 1 query
for post in posts:
    print(post.author.name)  # ← lazy load on every one
```

```ts
// Sequelize
const posts = await Post.findAll();
for (const post of posts) {
  await post.getAuthor();  // one query each
}
```

To make code look like ordinary objects, ORMs **lazy load**: the query goes out automatically when the attribute is accessed. The person writing it does not feel it; it takes a profiler to notice.

## The common GraphQL problem

```graphql
{
  posts {
    title
    author { name }
  }
}
```

GraphQL calls a resolver for each field separately. The posts resolver fetches 20 posts; the author resolver queries the user table once for each. Same 1+N.

## Fixes

### 1. JOIN

```sql
SELECT p.*, u.name AS author_name
FROM posts p
JOIN users u ON p.author_id = u.id
LIMIT 20;
```

One query covers everything, with the fewest round-trips.

### 2. Batch with IN

Query the posts first, collect all the author_ids, then query all the users at once:

```ts
const posts = await db.query('SELECT * FROM posts LIMIT 20');
const authorIds = posts.map(p => p.author_id);
const users = await db.query(
  'SELECT * FROM users WHERE id IN (?)', [authorIds]
);
const userMap = new Map(users.map(u => [u.id, u]));
posts.forEach(p => p.author = userMap.get(p.author_id));
```

From 21 queries down to 2. One more round-trip than JOIN, but the logic is clear, and it fits cases where the data is spread across several services / caches / DBs.

### 3. ORM preloading

```python
# Django
posts = Post.objects.select_related('author').all()  # JOIN
posts = Post.objects.prefetch_related('tags').all()  # one extra IN query
```

```ts
// Prisma
const posts = await prisma.post.findMany({ include: { author: true } });
```

ORMs do not preload on their own; you have to add it.

### 4. [DataLoader](chunk://dataloader) (the usual GraphQL approach)

Merges the N `.load(id)` calls of one round into a single IN query automatically. Details in [DataLoader](chunk://dataloader).

## How to spot it

- **Read the query log**: turn on SQL logging in dev, load the page, and count how many queries went out
- **APM**: Datadog / New Relic flag the N+1 pattern
- **By hand**: if the query count is clearly higher than the number of elements on the page, that is a warning sign
