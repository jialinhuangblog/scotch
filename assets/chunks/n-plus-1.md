---
title: "N+1 Query Problem"
slug: n-plus-1
brief: "拿一個 list，每個 item 各打一次 DB。應該 1 次 query 變成 1+N 次。ORM 跟 GraphQL 裡很常見、又不容易發現的效能問題。"
date: 2026-04-28
article: wishlist-dataloader
---

# N+1 Query Problem

> 「我只是寫了一個簡單的 for 迴圈，怎麼 DB latency 從 50ms 飆到 5 秒？」

## 場景：list 頁顯示作者名

20 個 blog post，要顯示每篇的作者名。直覺寫法：

```ts
const posts = await db.query('SELECT * FROM posts LIMIT 20');  // 1 次

for (const post of posts) {
  post.author = await db.query(
    'SELECT * FROM users WHERE id = ?', [post.author_id]
  );  // ← 每篇打一次，跑 20 次
}
```

實際打了 **1 + 20 = 21 次** DB query。每次 round-trip 5ms，總共 105ms。**改成一次 JOIN 只要 7ms**。

```text
N+1 寫法：21 round-trip × 5ms = 105ms
一次 JOIN：1 query × 7ms     = 7ms
```

100 篇 post 差距更大：1 + 100 vs 1。

## ORM 常見的問題

```python
# Django
posts = Post.objects.all()  # 1 query
for post in posts:
    print(post.author.name)  # ← 每個都 lazy load
```

```ts
// Sequelize
const posts = await Post.findAll();
for (const post of posts) {
  await post.getAuthor();  // 每個都打一次
}
```

ORM 為了讓 code 看起來像普通物件，**lazy load** 在你存取 attribute 時偷偷打 query。寫的人感覺不到，profile 才看得到。

## GraphQL 常見的問題

```graphql
{
  posts {
    title
    author { name }
  }
}
```

GraphQL 的 resolver 一個一個解。Posts resolver 拿 20 篇，author resolver 對每篇各打一次 user table。一樣 1+N。

## 解法

### 1. JOIN

```sql
SELECT p.*, u.name AS author_name
FROM posts p
JOIN users u ON p.author_id = u.id
LIMIT 20;
```

一個 query 全包。Postgres 最快的解法。

### 2. IN 批次查

撈 posts，收集所有 author_id，一次查所有 user：

```ts
const posts = await db.query('SELECT * FROM posts LIMIT 20');
const authorIds = posts.map(p => p.author_id);
const users = await db.query(
  'SELECT * FROM users WHERE id IN (?)', [authorIds]
);
const userMap = new Map(users.map(u => [u.id, u]));
posts.forEach(p => p.author = userMap.get(p.author_id));
```

從 21 次降到 2 次。比 JOIN 多一次往返，但邏輯清晰、適合分散在多個 service / cache / DB 的情況。

### 3. ORM 預載

```python
# Django
posts = Post.objects.select_related('author').all()  # JOIN
posts = Post.objects.prefetch_related('tags').all()  # 額外一次 IN 查
```

```ts
// Prisma
const posts = await prisma.post.findMany({ include: { author: true } });
```

要記得加，ORM 不會自動。

### 4. [DataLoader](chunk://dataloader)（GraphQL 標配）

把同一輪 N 個 `.load(id)` 自動合併成一次 IN query。下面細講。

## 怎麼發現

- **看 query log**：dev 環境打開 SQL log，跑頁面看跳幾次
- **APM**：Datadog / New Relic 會標 N+1 pattern
- **手動：query 數量超過頁面元素數量明顯太多就有嫌疑**

---

N+1 = 在迴圈裡打 query。寫起來像普通迴圈，但每圈都偷偷打一次網路。JOIN 或 [DataLoader](chunk://dataloader) 把它折回 1-2 次。
