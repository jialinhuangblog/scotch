---
title: "搜尋頁一列 20 筆，每筆又回頭查一次 DB，一頁就要 21 次 query"
slug: wishlist-dataloader
subtitle: "N+1 是寫在迴圈裡、讀 code 時看不出來的多次 round-trip。DataLoader 等 microtask 清完才送 query，把它們併成一次。"
chapter: "frontend-aware-backend"
tags: [n-plus-1, dataloader, graphql, optimistic-update]
date: 2026-04-28
updated: 2026-06-12
revisions: 2
related: [search-geo, search-cache]
---

# 搜尋頁一列 20 筆，每筆又回頭查一次 DB，一頁就要 21 次 query

Airbnb 搜尋結果頁一次顯示 20 個 listing（Airbnb 行話，指一間掛出來的房源，不是「列表」）。每張 card 右上角有 heart icon，user 已經收藏的要顯示紅心。需求看起來是兩行 code：

```ts
const listings = await db.listings.findMany({ limit: 20 });
for (const l of listings) {
  l.isWishlisted = await wishlistRepo.isSaved(currentUserId, l.id);  // 一間問一次，各打一次 DB
}
```

一次 DB round-trip 5ms，這段打了 21 次，105ms。改成一次 `IN` 查詢只要 8ms。這就是 [N+1 query problem](chunk://n-plus-1)：寫起來像普通 for 迴圈，但每圈都偷偷多一次網路往返。

後面的 code 會一直用到這三個名詞：

- **listing**：一間掛出來的房源（一個商品）。
- **wishlist**：user 自己建、會命名的收藏夾（「夏天歐洲」「蜜月」），一個 user 有很多本。
- 一本 wishlist 裝很多 listing，同一間 listing 也能進很多本。兩者是**多對多**，中間一張 `wishlist_items`（完整 schema 見文末）。

`isSaved()` 底下真正的 SQL 要 join 兩張表才問得出來。

搜尋頁那顆愛心是 **boolean**：這間房只要進了任何一本清單就亮紅。它跟後面要做的「在你幾個收藏夾」是同一份資料的兩種問法（有沒有 / 幾本）。Airbnb 這套設計裡 **heart 就是 wishlist，沒有獨立的 likes 表**，點愛心就是加進某本收藏夾。

收藏夾內容頁的方向剛好相反：以 wishlist 為主，問「這本清單裡有哪些房」。底下的 N+1 都發生在搜尋頁。

---

## N+1 怎麼來的

照直覺寫，在 ORM 跟 GraphQL 裡都很自然就會寫出 N+1。

### ORM：lazy load 的副作用

```python
# Django
posts = Post.objects.all()
for post in posts:
    print(post.author.name)  # ← 每次存取 attribute 都偷偷 query
```

```ts
// Sequelize
const posts = await Post.findAll();
for (const post of posts) {
  await post.getAuthor();  // 每次都打一次
}
```

ORM 為了讓 code 看起來像普通物件，會在存取 attribute 時用 lazy load 偷偷送出 query。寫的人感覺不到，要 profile 才看得出來。

### GraphQL：resolver 一個一個跑

```graphql
{
  posts {
    title
    author { name }
  }
}
```

GraphQL 的 author resolver 對每個 post 各跑一次。20 個 post 的 author resolver 各自呼叫 `db.users.findById(post.author_id)`。一樣 1+N。

---

## DataLoader：把分散的 .load() 併成一次 query

[DataLoader](chunk://dataloader) 是 Facebook 的解法，GraphQL 服務常搭配它。**resolver 的寫法不變，DataLoader 在背後合併 query**：

```ts
const userLoader = new DataLoader(async (ids) => {
  const users = await db.users.findMany({ id: { in: ids } });
  const map = new Map(users.map(u => [u.id, u]));
  return ids.map(id => map.get(id) ?? null);
});

// resolver 照樣一個一個呼叫，但結果只打 1 次 DB
const author = await userLoader.load(post.author_id);
```

DataLoader 利用的是 event loop 的執行順序。一段同步 code 跑完，Node 先清 nextTick queue，再清 microtask queue，兩個都空了才輪到下一段。DataLoader 把「送出 query」排在這輪清理的最後面。

<details>
<summary><strong>原始碼怎麼跑：load / getCurrentBatch / dispatchBatch / 兩層 wrap</strong>（想看內部機制再點開）</summary>

### `.load()` 內部（原始碼）

`.load(key)` 不碰 DB。以下直接取自 [graphql/dataloader `src/index.js`](https://github.com/graphql/dataloader/blob/main/src/index.js)，一字未改，只省略 null 檢查與型別斷言：

```js
load(key) {
  // ... (key 為 null/undefined 時 throw，略)
  const batch = getCurrentBatch(this);   // 取得目前 batch；沒有就建新的並排好 dispatch
  const cacheMap = this._cacheMap;

  // If caching and there is a cache-hit, return cached Promise.
  if (cacheMap) {
    const cachedPromise = cacheMap.get(this._cacheKeyFn(key));
    if (cachedPromise) { /* 排進 batch.cacheHits，dispatch 時一起 resolve */ }
  }

  // Otherwise, produce a new Promise for this key, and enqueue it.
  batch.keys.push(key);
  const promise = new Promise((resolve, reject) => {
    batch.callbacks.push({ resolve, reject });   // 把 resolve/reject 兩個函式「存進」batch，不是呼叫
  });
  if (cacheMap) cacheMap.set(this._cacheKeyFn(key), promise);
  return promise;          // 立刻回傳，但停在 pending
}
```

`new Promise(executor)` 的 executor 同步跑，所以 `callbacks.push({ resolve, reject })` 當場執行，把兩個函式**存起來**（不是呼叫 `resolve()`），promise 因此停在 pending。

上面 load() 第一行那個 `getCurrentBatch(this)` 就是這個 function。「建 batch + 排 dispatch」都在它裡面，而且**只有開新批的時候才會排那一次 dispatch**（後續的 load 共用現成 batch，不會再排）：

```js
function getCurrentBatch(loader) {
  // 有現成 batch（還沒 dispatch、還沒滿）就直接回它 → 後續 load 共用同一批
  const b = loader._batch;
  if (b !== null && !b.hasDispatched && b.keys.length < loader._maxBatchSize) return b;
  // 否則建新 batch，並排一次 dispatch
  const newBatch = { hasDispatched: false, keys: [], callbacks: [] };
  loader._batch = newBatch;
  loader._batchScheduleFn(() => dispatchBatch(loader, newBatch));   // 預設 enqueuePostPromiseJob
  return newBatch;
}
```

dispatch 收齊結果後，按 index 交給各自的 promise：

```js
function dispatchBatch(loader, batch) {
  batch.hasDispatched = true;
  const batchPromise = loader._batchLoadFn(batch.keys);   // 你的 IN query 在「這一刻」送出
  batchPromise.then(values => {                           // DB 回來後才跑
    for (let i = 0; i < batch.callbacks.length; i++) {
      const v = values[i];
      v instanceof Error ? batch.callbacks[i].reject(v) : batch.callbacks[i].resolve(v);
    }
  });
}
```

### 兩層 wrap：dispatch 排在 microtask 清完之後

`_batchScheduleFn` 預設是 `enqueuePostPromiseJob`（[同源](https://github.com/graphql/dataloader/blob/main/src/index.js)）：

```js
const enqueuePostPromiseJob =
  typeof process === 'object' && typeof process.nextTick === 'function'
    ? function (fn) {
        if (!resolvedPromise) resolvedPromise = Promise.resolve();
        resolvedPromise.then(() => process.nextTick(fn));   // 有 nextTick → 兩層
      }
    : typeof setImmediate === 'function'
    ? (fn) => setImmediate(fn)                               // 否則退 setImmediate
    : (fn) => setTimeout(fn);                                // 再否則 setTimeout
```

兩個檢查點的細節在下一節。這裡只看它排出來的順序：

```text
sync 結束
  ↓ 清 nextTick（此刻空的，dispatch 還沒被排）
  ↓ 清 microtask：Promise.then 跑 → 這裡才 process.nextTick(dispatch)
  ↓ 再清 nextTick（這次有 dispatch）→ dispatch 執行
```

沒有 `process.nextTick` 的環境（瀏覽器、純 web Workers）退成 `setImmediate` / `setTimeout`，那是 macrotask、本來就排在所有 microtask 之後，所以一層就夠。

### 落在哪個 phase

```text
poll  ─ 收到 GraphQL request（網路 I/O，落在 poll）
      │   resolver 同步跑：load(101) … load(120)   ← push key 進 batch（累積）
      ├─ poll callback 跑完 → 清 nextTick（空）→ 清 microtask → 排 nextTick(dispatch)
      ├─ 再清 nextTick → dispatch → batchLoadFn 送出 1 次 SELECT ... IN（飛走）
═══ 之後某個 tick，DB 回來 ═══
poll  ─ DB response 到 → 清 microtask → 按 index resolve 每張 .load() 的 promise
```

</details>

### 什麼算「同一批」

`.load()` 在同步階段就是不斷把 101、102、103 這些 id 搜集進 batch，dispatch 那個 job 要等這段 code 跑完才執行。JS 是 single thread，所以跑完之前不會去執行它，`load(101)`、`load(102)` 都可以被放在一起，不會有人偷跑。

一個 callback 結束之後，有兩個檢查點會清 nextTick：

- **檢查點 1**：callback 一結束就清 nextTick
- **檢查點 2**：microtask 清空之後再清一次 nextTick

直接寫 `process.nextTick(dispatch)` 趕得上檢查點 1，排在所有 promise callback 前面。同步跑的 `load(101)` 收得到，但寫在 `await` 後面的 resolver 還沒執行，`load(102)`、`load(103)` 之後才斷斷續續進來。每個晚到的都各自開一個新 batch，在下一個檢查點就送出，湊不成一組。

**DataLoader 包一層 `.then` 就是為了故意錯過檢查點 1，改成在 microtask 清到一半時才排隊，只好等檢查點 2。**

#### 哪些 `.load()` 會落在同一批

同步區段、或同一輪 microtask（promise 接 promise、沒真 I/O）裡的 `.load()` 都進同一批；中間混到**真 I/O / setTimeout** 才會被切開，因為那時已經是不同 phase 了。

```ts
// ✓ Promise.all：同批 → 1 次 query（官方 loader.loadMany(ids) 是這個的封裝）
await Promise.all(ids.map(id => loader.load(id)));

// ✗ 手寫順序 loop：每個 await 讓出去、dispatch 先發，各成一批 → N 次 query
for (const id of ids) await loader.load(id);
```

GraphQL resolver 那種每個 field 各自 `await load()` 是安全的：engine 並行呼叫 sibling resolver，load 都在同一輪。會讓 batching 失效的只有**手寫的順序 loop**。

---

## 回到 Wishlist

20 個 listing 的 heart icon 怎麼查？批次 API：

```text
GET /api/wishlists/check?listingIds=101,102,103,...,120

Response:
{
  "101": ["wishlist-a", "wishlist-b"],
  "102": [],
  "103": ["wishlist-a"],
  ...
}
```

一次打，O(1) 個 request。Backend 內部用 DataLoader：

```ts
// resolver 寫法不變
const wishlistInfo = await req.loaders.wishlist.load(listing.id);

// DataLoader 內部
const createWishlistLoader = (currentUserId) => new DataLoader(async (listingIds) => {
  const rows = await db.query(`
    SELECT wi.listing_id, wi.wishlist_id
    FROM wishlist_items wi
    JOIN wishlists w ON w.id = wi.wishlist_id   -- wishlist_items 沒有 user_id，要問 wishlists
    WHERE w.user_id = ? AND wi.listing_id IN (?)
  `, [currentUserId, listingIds]);

  const map = new Map();
  for (const r of rows) {
    const list = map.get(r.listing_id) ?? [];
    list.push(r.wishlist_id);
    map.set(r.listing_id, list);
  }

  return listingIds.map(id => map.get(id) ?? []);
});
```

20 個 listing 的 wishlist 狀態 = 1 次 DB query。

這個 loader 每個 HTTP request 要開新的一份。它閉包裡包著 `currentUserId`，內建的 cache 也只該在這一個 request 裡有效。NestJS 用 REQUEST scope 或 GraphQL context 建，Express 就掛在 middleware：

```ts
app.use((req, res, next) => {
  req.loaders = { wishlist: createWishlistLoader(req.user.id) };
  next();
});
```

<details>
<summary><strong>batch function 會踩到的地方：回傳順序、一對多、cache 範圍</strong>（自己實作時再點開）</summary>

**回傳的順序要跟 input 對齊。** DB 回來的 row 順序不保證跟 `ids` 一樣，長度也不保證（id 查不到就沒有那筆）。直接 `return rows`，`.load(7)` 會拿到別人的資料：

```ts
// ❌ 直接回 rows，順序錯亂
return rows;

// ✅ 用 ids 的順序重新對位，查不到的填 null
const map = new Map(rows.map(r => [r.id, r]));
return ids.map(id => map.get(id) ?? null);
```

DataLoader 把 batch 結果按 input 順序對回去 `.load()` 的 promise，所以第 i 個結果一定要是第 i 個 id 的答案。

**一對多要自己 group。** 一個 `listing_id` 可能對到好幾筆 `wishlist_items`。上面那個 `map.set(r.listing_id, list)` 迴圈就是在做 group by，回的是陣列不是單筆，查不到的填 `[]` 而不是 `null`。

**cache 只在這個 request 裡有效。** 同一輪裡 `.load(101)` 兩次，第二次直接取得同一個 promise，不會再查一次 DB：

```ts
const a = loaders.wishlist.load(101);
const b = loaders.wishlist.load(101);
// a === b（同一個 promise）
```

跨 request 共用同一個 instance，alice 的收藏就會被 cache 給 bob。同一個 request 裡先 mutation 再 query 也會讀到舊值，那時要 `loader.clear(key)`，文末「什麼時候會後悔」那節有寫。

</details>

---

## API 設計：動作不是覆寫

新人寫 wishlist API 第一反應：

```ts
PUT /api/wishlists/:id
{ "listings": ["listing-1", "listing-2", "listing-5"] }
```

**race condition**：A 裝置讀到 `[1,2,3]` 加 4，送 `[1,2,3,4]`。B 裝置同時讀到 `[1,2,3]` 加 5，送 `[1,2,3,5]`。**後到的覆蓋先到的**。

所以要改成一次只送一個動作（加一筆或移一筆），不是每次覆寫整份清單：

```ts
POST   /api/wishlists/:id/listings              // 加一個
DELETE /api/wishlists/:id/listings/:listingId    // 移除一個
```

每個動作獨立 idempotent。DB 用 `(wishlist_id, listing_id)` 當複合 PK，重複加自動忽略。

**這個 request 表達的是「我想要的最終狀態」，還是「我這一刻想做的動作」？** Wishlist 是後者。覆寫式 API 適合 form 提交、組態檔案，這種「使用者一次決定全部」的場景。

---

## 點 heart 之後要等 200ms 才變紅：optimistic update

API 設計好了，但前端還有問題。Click heart 到 server response 中間 200ms：

```text
0ms    user 點 heart
0ms    UI 還是白心（等 API）
200ms  API 回來，UI 變紅
```

200ms 卡一下，搜尋頁滑來滑去點幾次每次都頓，用起來很煩。

[Optimistic update](chunk://optimistic-update)：先改 UI，假設成功，失敗才 rollback。

```ts
function toggleWishlist(listingId) {
  setIsWishlisted(true);  // 立刻變紅

  api.add(listingId).catch(() => {
    setIsWishlisted(false);  // 失敗 rollback
    toast('儲存失敗，請重試');
  });
}
```

跟 client cache（React Query / SWR / Zustand）一起做：

```ts
// 1. 直接改 client cache
queryClient.setQueryData(['wishlist', userId], (old) => [...old, listingId]);

// 2. 打 API
mutation.mutate(listingId, {
  onError: () => {
    // 3. rollback cache
    queryClient.setQueryData(['wishlist', userId], (old) =>
      old.filter(id => id !== listingId)
    );
  },
  onSettled: () => {
    // 4. 最後跟 server 同步一次（保險）
    queryClient.invalidateQueries(['wishlist', userId]);
  },
});
```

滑到第二頁再滑回來，client cache 已經是紅心狀態，**不需要重打 API 問 server**。前端 cache + optimistic update 讓 user 感覺不到等 server 回應的 latency。

---

## DB 跟 cache 設計

### Schema

```text
user ──< wishlists ──< wishlist_items >── listings
        多個具名清單       多對多
```

```sql
CREATE TABLE wishlists (
  id          UUID PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id),
  name        VARCHAR(100),
  share_token UUID UNIQUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_wishlists_user ON wishlists(user_id);

CREATE TABLE wishlist_items (
  wishlist_id UUID NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
  listing_id  UUID NOT NULL,
  added_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (wishlist_id, listing_id)
);
CREATE INDEX idx_wishlist_items_listing ON wishlist_items(listing_id);
```

塞幾筆資料進去，三張表的分工就看得出來：

`listings`

| id | 名稱 |
|---|---|
| L1 | 巴黎小閣樓 |
| L2 | 京都町屋 |
| L3 | 冰島小屋 |

`wishlists`

| id | user_id | name |
|---|---|---|
| W1 | alice | 夏天歐洲 |
| W2 | alice | 冬天看極光 |
| W3 | bob | 隨便看看 |

`wishlist_items`

| wishlist_id | listing_id |
|---|---|
| W1 | L1 |
| W2 | L1 |
| W1 | L3 |
| W3 | L2 |

alice 的搜尋頁排出 L1、L2、L3 三張卡片。正確結果是 L1 紅心、在她兩本清單裡；L3 紅心、一本；L2 白心，因為那是 bob 收的。

`wishlist_items` 只有 `wishlist_id` 跟 `listing_id`。W1、W2、W3 在這張表上長得一模一樣，看不出來是誰的，所以「只要 alice 的」這個條件在這裡寫不出來，得先去 `wishlists` 問每個 W 屬於誰：

```sql
SELECT wi.listing_id, COUNT(*) AS in_n_lists
FROM wishlist_items wi
JOIN wishlists w ON w.id = wi.wishlist_id   -- 每筆補上 user_id
WHERE w.user_id = $1                        -- 這下才篩得掉 bob 的 W3
  AND wi.listing_id IN ($2, $3, ...)        -- 這頁的 20 個 listing
GROUP BY wi.listing_id;                     -- 同一間房的多筆併一筆，順便數出在幾本清單裡
```

回來的結果：

| listing_id | in_n_lists |
|---|---:|
| L1 | 2 |
| L3 | 1 |

L2 沒出現在結果裡，前端就給它白心。`$1` 來自這個 request 的登入身分，`IN (...)` 來自 DataLoader 收齊的那一批 id。

想省掉這個 join 的話，做法是把 `user_id` 也存一份進 `wishlist_items`，索引直接開 `(user_id, listing_id)`。代價是同一個事實存兩份，清單易主時兩邊都要改。這份 schema 沒走那條，因為搜尋頁前面還有一層 Redis（後面 cache 那節）。

### heart 要不要獨立一張 likes 表

搜尋頁那顆愛心，要不要自己一張表？這題在寫 schema 那天就得決定，等上線之後再改要搬資料。

**合併（這版選的）**：沒有 likes 表，heart 紅 = `wishlist_items` 裡有 row，只有一個 source of truth。代價是點愛心**必須**決定丟進哪個清單，所以 UI 得跳「存到哪個收藏夾」，或先塞進一個預設清單再讓 user 自己搬。Airbnb 走這條。

**分開**：另開 `likes(user_id, listing_id)`，愛心點一下就加、不用選清單，收藏夾是另一個比較慎重的整理動作。IG/Twitter 的讚、Pinterest 的 quick save 偏這種。代價是兩張表、兩個 source of truth，還得定義「讚了但沒進任何收藏夾」「進了收藏夾但沒按讚」各算什麼狀態。

如果「收藏」本身就是核心動作、user 本來就要分類整理（Airbnb 的旅行規劃），合併最乾淨，少一張表少一種不一致。如果「讚」只是輕量表態、跟「收進清單」是兩種不同強度的意圖（電商的「想要」vs「比價清單」），分開才能把兩種意圖分別記下來。

**什麼時候會後悔**：選了合併，等產品哪天要「快速喜歡但先不分類」時會卡住，因為 heart 一定綁著一個清單。那時先補一個「未分類」預設清單頂著，真的需要再拆出 likes 表，不必一開始就為這個可能性多維護一張表。

### 為什麼用 SQL 不用 NoSQL

- Schema 固定（name, user_id, items）
- 多對多（一個 listing 可以在多個 wishlist）
- 讀寫比 100:1，SQL 加一層 cache 就夠應付
- 不需要 flexible schema

### Cache：讀多寫少，所以前面加一層 Redis

```text
Redis：
  key: user:{userId}:wishlisted_listings
  value: Set<listingId>
  TTL: 10 min
```

搜尋結果頁打 `/wishlists/check` 時先查 Redis，miss 才查 DB。加/移 listing 時同步更新 cache（write-through）。

跨裝置同步：手機加了 wishlist，電腦要看到。不需要 real-time（不是聊天室），eventual consistency 就好：

- Cache TTL 10 min → 最慢 10 分鐘後看到
- 點進某個收藏夾看裡面的 listing 時，強制 refetch（bypass cache）
- Optimistic update 只在當前裝置，其他裝置等 cache 到期

---

## 特殊情況

| 場景 | 處理 |
|---|---|
| Listing 被下架但在 wishlist 裡 | 顯示「此房源已不可用」，不自動刪除（user 可能想留紀錄） |
| 加入時網路失敗 | Optimistic rollback + toast |
| 一個 listing 在多個 wishlist | `/check` API 回 array of wishlist IDs |
| Wishlist 太多 listings（500+） | 分頁載入，cursor pagination |
| 並發加/移同一筆 | DB 的 PK constraint 拒絕重複，移除用 DELETE，不存在就 no-op |
| 刪 wishlist | CASCADE 刪 wishlist_items |
| 未登入點 heart | 導登入頁，URL 帶 intent param `?wishlist_action=add&listing=123` |

---

## 決策場景

同樣的功能，什麼時候用不到 DataLoader？

要是 N+1 發生在自己掌控的 endpoint loop 裡，就用不到。id 全在手上，收齊之後送一次 `IN` 就好：

```ts
const listings = await db.listings.findMany({ limit: 20 });
const ids = listings.map(l => l.id);              // ← 有一個地方可以收集全部 id
const saved = await db.wishlistItems.findMany({ where: { listing_id: { in: ids } } });
```

DB query 從 21 次變 2 次，105ms 降到 13ms（listing 那次 5ms 加 `IN` 那次 8ms），沒有引進任何 library。

需求變成「在你的 N 個收藏夾裡」之後，這個做法就不能用了。這次的查詢散在 GraphQL 各 field resolver，每個 resolver 只拿得到自己那一個 listing：

```ts
@ResolveField()
wishlistCount(@Parent() listing) {
  // 只拿得到當前這一個 listing，沒有地方讓你先收集 20 個 id
  return loaders.wishlistCount.load(listing.id);
}
```

DataLoader 補的就是那個收集點。兩種寫法的結果一樣（都是一句 `IN`），差別在 id 是手動收還是自動收。所以要看的是找不找得到一個地方把 id 收齊，找得到就自己收，找不到才需要它。

前端那 200 毫秒是另一回事。那是點愛心到 API 回來的整段時間，包含網路來回，不會因為 query 從 21 次變 2 次就消失，只能靠 [optimistic update](chunk://optimistic-update) 讓 user 不必等。

### 什麼時候會後悔

DataLoader 的 per-request cache 在大多數情況是好事，但有一個 case 會出問題：mutation 後的同一輪 query 會看到舊資料。

```ts
// 同一個 GraphQL request 裡
mutation { addToWishlist(...) }    // 寫
query    { user { wishlistCount } } // 讀：DataLoader cache 還是舊的
```

修法是 mutation 後呼叫 `loader.clear(key)` 或 `loader.clearAll()`。

Optimistic update 會後悔的情況是**操作不可逆**。Wishlist 加錯了 rollback 沒事，但「發送訊息」「下訂單」這種操作，畫面先顯示「已送出」結果卻失敗，user 會覺得被騙。
