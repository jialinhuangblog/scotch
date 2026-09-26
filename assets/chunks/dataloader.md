---
title: "DataLoader Batching"
slug: dataloader
brief: "同一輪事件迴圈排出的 .load(id) 累成一批，到邊界一次 dispatch 成一條 IN query。GraphQL 的 N+1 解法。"
date: 2026-04-28
updated: 2026-07-20
revisions: 3
article: wishlist-dataloader
---

# DataLoader Batching

> GraphQL resolver 自然寫法是一個個 `.load(id)`，怎麼讓它們自動合併成一次 DB query？

## 場景：N+1

```graphql
{ posts { author { name } } }
```

20 個 post 各跑一次 author resolver，每個都這樣寫：

```ts
const author = await db.query('SELECT * FROM users WHERE id = ?', post.author_id);
```

[N+1](chunk://n-plus-1) 經典場景：20 次 round-trip，因為每個 resolver 都不知道其他 resolver 也在查詢 users。

## 怎麼用

resolver 寫法不變，DataLoader 在底下把這些 `.load()` 合併：

```ts
const userLoader = new DataLoader(async (ids) => {
  const users = await db.query('SELECT * FROM users WHERE id IN (?)', [ids]);
  const map = new Map(users.map(u => [u.id, u]));
  return ids.map(id => map.get(id) ?? null);
});

// resolver 內，照樣一個一個呼叫：
const author = await ctx.userLoader.load(post.author_id);
```

20 個 resolver 各自 `.load(id)`，底下實際只發 1 次 DB query。

## 核心機制

`.load(key)` 不碰 DB。它把 key 累積進一個 batch、當場回傳一張 **pending promise**（resolve 函式先存進 batch，跟 key 用 index 對齊），然後在**事件迴圈邊界**一次 dispatch：呼叫自己寫的 batch function（那句 `IN` query），DB 回來後按 index 把每張 promise 補上值。

```text
load(101) load(102) … load(120)   ← 同一輪累積進 batch
        ↓ 事件迴圈邊界
batchFn([101..120]) → 1 次 SELECT ... IN (...)
        ↓ DB 回來
按 index resolve 每張 .load() 的 promise
```

「同一輪」怎麼界定、dispatch 的時機怎麼決定（`Promise.then` + `process.nextTick` 兩層 wrap）、逐字源碼怎麼跑、落在 event loop 哪個 phase、放進 NestJS + ORM 長怎樣，完整拆解見文章 [搜尋頁一列 20 筆，每筆又回頭查一次 DB，一頁就要 21 次 query](article://wishlist-dataloader)。

## 三種寫法的後果

```ts
// ✓ 同步排完：100 個 id 同批 → 1 次 query
for (let i = 0; i < 100; i++) loader.load(i);

// ✓ Promise.all：.map 同步呼叫 100 次 .load()，同批 → 1 次 query
//   （官方 loader.loadMany(ids) 就是這個的封裝）
await Promise.all(ids.map(id => loader.load(id)));

// ✗ await 在順序 loop 裡：每個 await 讓出去、dispatch 先發，各成一批 → 100 次 query
for (let i = 0; i < 100; i++) await loader.load(i);
```

最後那種寫法最常出錯。但 GraphQL resolver 那種「每個 field 各自 `await load()`」是安全的，因為 engine 並行呼叫 sibling resolver，load 都在同一輪、進同一批。會讓 batching 失效（退回 N+1）的，只有**手寫的順序 loop**。

## Per-request cache

DataLoader 內建 cache，同一個 instance 裡 `.load(101)` 第二次直接回傳上次那張 promise（同 key 一個 request 只查一次）：

```ts
const a = userLoader.load(101);
const b = userLoader.load(101);
// a === b
```

**每個 HTTP request 用自己的 DataLoader instance。** 跨 request 共用的話，A 使用者查過的資料會留在 cache 裡，B 使用者的 request 會直接取得這份資料，私密資料就外洩了。

## 跟 ORM 預載的差別

| | ORM `include` / `select_related` | DataLoader |
|---|---|---|
| 哪一層 | DB query 層級 | application 層級 |
| 寫法 | 起點宣告 join | resolver 維持 `.load()` |
| 跨 service | 不適用 | 跨 service / 跨 DB / 跨 cache |
| 跟 GraphQL | resolver 逐欄位解析，無法在起點預先 join | 為 GraphQL 設計 |
