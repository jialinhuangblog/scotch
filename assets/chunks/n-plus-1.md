---
title: "N+1 Query Problem"
slug: n-plus-1
brief: "取得一個 list 後，每個 item 各查一次 DB，query 從 1 次變成 1+N 次。ORM 跟 GraphQL 裡很常見，又不容易發現。"
date: 2026-04-28
article: wishlist-dataloader
---

# N+1 Query Problem

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

實際送出了 **1 + 20 = 21 次** DB query。每次 round-trip 5ms，總共 105ms。**改成一次 JOIN 只要 7ms**。

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

ORM 為了讓 code 看起來像普通物件，**lazy load** 會在存取 attribute 時才自動送出 query。寫的人感覺不到，要 profile 才會發現。

## GraphQL 常見的問題

```graphql
{
  posts {
    title
    author { name }
  }
}
```

GraphQL 對每個欄位各自呼叫 resolver。Posts resolver 取得 20 篇，author resolver 對每篇各查詢一次 user table。一樣 1+N。

## 解法

### 1. JOIN

```sql
SELECT p.*, u.name AS author_name
FROM posts p
JOIN users u ON p.author_id = u.id
LIMIT 20;
```

一個 query 全包，round-trip 最少。

### 2. IN 批次查

先查詢 posts，收集所有 author_id，再一次查詢所有 user：

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

ORM 不會自動預載，要自己加。

### 4. [DataLoader](chunk://dataloader)（GraphQL 常用的做法）

把同一輪 N 個 `.load(id)` 自動合併成一次 IN query。細節在 [DataLoader](chunk://dataloader)。

## 怎麼發現

- **看 query log**：dev 環境打開 SQL log，載入頁面看送出幾次 query
- **APM**：Datadog / New Relic 會標 N+1 pattern
- **手動**：query 數量明顯多過頁面上的元素數量，就有嫌疑
