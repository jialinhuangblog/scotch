---
title: "A search page lists 20 rows, each row hits the DB again, and one page costs 21 queries"
slug: wishlist-dataloader
subtitle: "N+1 is a pile of round trips written inside a loop, invisible when you read the code. DataLoader waits until the microtasks are drained before sending the query, and merges them into one."
chapter: "frontend-aware-backend"
tags: [n-plus-1, dataloader, graphql, optimistic-update]
date: 2026-04-28
updated: 2026-10-17
revisions: 3
related: [search-geo, search-cache]
---

# A search page lists 20 rows, each row hits the DB again, and one page costs 21 queries

An Airbnb search results page shows 20 listings at a time (Airbnb's word for one home put up for rent, not a "list"). Each card has a heart icon in the top right corner, and a listing the user has already saved shows a red heart. The requirement looks like two lines of code:

```ts
const listings = await db.listings.findMany({ limit: 20 });
for (const l of listings) {
  l.isWishlisted = await wishlistRepo.isSaved(currentUserId, l.id);  // one question per listing, one DB call each
}
```

One DB round trip is 5ms. This block makes 21 of them, 105ms. A single `IN` query instead takes 8ms. This is the [N+1 query problem](chunk://n-plus-1): it reads like an ordinary for loop, but every iteration quietly adds one network round trip.

The code below keeps using three terms:

- **listing**: one home put up for rent (one product).
- **wishlist**: a saved collection the user creates and names ("Summer in Europe", "Honeymoon"). One user has many of them.
- One wishlist holds many listings, and the same listing can be in many wishlists. The two are **many-to-many**, with a `wishlist_items` table in between (full schema at the end of the article).

The SQL under `isSaved()` has to join two tables to answer the question.

The heart on the search page is a **boolean**: the listing turns red as soon as it is in any wishlist at all. The later feature, "in N of your wishlists", is the same data asked a second way (yes or no / how many). In Airbnb's design, **the heart is the wishlist, there is no separate likes table**. Clicking the heart adds the listing to one of the wishlists.

The wishlist detail page goes the opposite direction: it starts from the wishlist and asks "which listings are in this one". All the N+1 below happens on the search page.

---

## Where N+1 comes from

Written the intuitive way, both an ORM and GraphQL produce N+1 without anyone trying.

### ORM: a side effect of lazy loading

```python
# Django
posts = Post.objects.all()
for post in posts:
    print(post.author.name)  # ← every attribute access quietly runs a query
```

```ts
// Sequelize
const posts = await Post.findAll();
for (const post of posts) {
  await post.getAuthor();  // one DB call every time
}
```

To make the code look like plain objects, the ORM lazy loads: it quietly sends a query when you access the attribute. The person writing it does not notice. It only shows up in a profile.

### GraphQL: resolvers run one at a time

```graphql
{
  posts {
    title
    author { name }
  }
}
```

The GraphQL author resolver runs once per post. For 20 posts, each author resolver calls `db.users.findById(post.author_id)` on its own. Same 1+N.

---

## DataLoader: merge the scattered .load() calls into one query

[DataLoader](chunk://dataloader) is Facebook's fix, and GraphQL services often pair with it. **The resolver code does not change. DataLoader merges the queries behind it**:

```ts
const userLoader = new DataLoader(async (ids) => {
  const users = await db.users.findMany({ id: { in: ids } });
  const map = new Map(users.map(u => [u.id, u]));
  return ids.map(id => map.get(id) ?? null);
});

// the resolver still calls one at a time, but only 1 DB query goes out
const author = await userLoader.load(post.author_id);
```

DataLoader relies on the execution order of the event loop. When a block of synchronous code finishes, Node drains the nextTick queue first, then the microtask queue, and only when both are empty does the next block get its turn. DataLoader schedules "send the query" at the very end of that cleanup.

<details>
<summary><strong>How the source runs: load / getCurrentBatch / dispatchBatch / the double wrap</strong> (open this if you want the internals)</summary>

### Inside `.load()` (source)

`.load(key)` does not touch the DB. The code below is taken directly from [graphql/dataloader `src/index.js`](https://github.com/graphql/dataloader/blob/main/src/index.js), unchanged except that the null checks and type assertions are left out:

```js
load(key) {
  // ... (throws when key is null/undefined, omitted)
  const batch = getCurrentBatch(this);   // get the current batch; if none, create one and schedule its dispatch
  const cacheMap = this._cacheMap;

  // If caching and there is a cache-hit, return cached Promise.
  if (cacheMap) {
    const cachedPromise = cacheMap.get(this._cacheKeyFn(key));
    if (cachedPromise) { /* queued into batch.cacheHits, resolved together at dispatch */ }
  }

  // Otherwise, produce a new Promise for this key, and enqueue it.
  batch.keys.push(key);
  const promise = new Promise((resolve, reject) => {
    batch.callbacks.push({ resolve, reject });   // "store" the resolve/reject functions in the batch, do not call them
  });
  if (cacheMap) cacheMap.set(this._cacheKeyFn(key), promise);
  return promise;          // returned right away, but stays pending
}
```

The executor of `new Promise(executor)` runs synchronously, so `callbacks.push({ resolve, reject })` executes on the spot. It **stores** the two functions (it does not call `resolve()`), so the promise stays pending.

The `getCurrentBatch(this)` on the first line of load() above is this function. "Create the batch + schedule the dispatch" both live inside it, and **the dispatch is only scheduled when a new batch is opened** (later loads share the existing batch and schedule nothing):

```js
function getCurrentBatch(loader) {
  // an existing batch (not dispatched yet, not full yet) is returned as is → later loads share it
  const b = loader._batch;
  if (b !== null && !b.hasDispatched && b.keys.length < loader._maxBatchSize) return b;
  // otherwise create a new batch and schedule one dispatch
  const newBatch = { hasDispatched: false, keys: [], callbacks: [] };
  loader._batch = newBatch;
  loader._batchScheduleFn(() => dispatchBatch(loader, newBatch));   // default: enqueuePostPromiseJob
  return newBatch;
}
```

After dispatch collects the results, it hands them to each promise by index:

```js
function dispatchBatch(loader, batch) {
  batch.hasDispatched = true;
  const batchPromise = loader._batchLoadFn(batch.keys);   // your IN query goes out at "this moment"
  batchPromise.then(values => {                           // runs only after the DB returns
    for (let i = 0; i < batch.callbacks.length; i++) {
      const v = values[i];
      v instanceof Error ? batch.callbacks[i].reject(v) : batch.callbacks[i].resolve(v);
    }
  });
}
```

### The double wrap: dispatch is scheduled after the microtasks drain

`_batchScheduleFn` defaults to `enqueuePostPromiseJob` ([same source](https://github.com/graphql/dataloader/blob/main/src/index.js)):

```js
const enqueuePostPromiseJob =
  typeof process === 'object' && typeof process.nextTick === 'function'
    ? function (fn) {
        if (!resolvedPromise) resolvedPromise = Promise.resolve();
        resolvedPromise.then(() => process.nextTick(fn));   // nextTick exists → two layers
      }
    : typeof setImmediate === 'function'
    ? (fn) => setImmediate(fn)                               // otherwise fall back to setImmediate
    : (fn) => setTimeout(fn);                                // and otherwise setTimeout
```

The details of the two checkpoints are in the next section. Here, only the order it produces:

```text
sync ends
  ↓ drain nextTick (empty right now, dispatch not scheduled yet)
  ↓ drain microtasks: Promise.then runs → only here does process.nextTick(dispatch) happen
  ↓ drain nextTick again (dispatch is in it this time) → dispatch runs
```

Environments without `process.nextTick` (browsers, plain web Workers) fall back to `setImmediate` / `setTimeout`. Those are macrotasks, already queued after every microtask, so one layer is enough.

### Which phase it lands in

```text
poll  ─ GraphQL request arrives (network I/O, lands in poll)
      │   resolvers run synchronously: load(101) … load(120)   ← push keys into the batch (piling up)
      ├─ poll callback finishes → drain nextTick (empty) → drain microtasks → schedule nextTick(dispatch)
      ├─ drain nextTick again → dispatch → batchLoadFn sends 1 SELECT ... IN (in flight)
═══ some later tick, the DB returns ═══
poll  ─ DB response arrives → drain microtasks → resolve each .load() promise by index
```

</details>

### What counts as "the same batch"

During the synchronous phase, `.load()` keeps collecting ids 101, 102, 103 into the batch. The dispatch job waits until this block of code finishes. JS is single threaded, so nothing runs that job before then. `load(101)` and `load(102)` both land in the same batch, and nothing gets ahead of the queue.

After a callback ends, there are two checkpoints where nextTick is drained:

- **Checkpoint 1**: nextTick is drained as soon as the callback ends
- **Checkpoint 2**: after the microtasks are empty, nextTick is drained once more

A plain `process.nextTick(dispatch)` makes checkpoint 1 and runs ahead of every promise callback. It catches the synchronous `load(101)`, but the resolvers written after an `await` have not run yet, and `load(102)`, `load(103)` trickle in later. Each late one opens its own new batch and is sent at the next checkpoint. They never form a group.

**DataLoader wraps one more `.then` around it. The dispatch is not queued until the microtasks reach that `.then`, so it misses checkpoint 1 and has to wait for checkpoint 2.**

#### Which `.load()` calls land in the same batch

A `.load()` in the synchronous section, or in the same round of microtasks (promise after promise, no real I/O), goes into the same batch. Only **real I/O / setTimeout** in between splits them, because by then it is a different phase.

```ts
// ✓ Promise.all: one batch → 1 query (the official loader.loadMany(ids) is a wrapper around this)
await Promise.all(ids.map(id => loader.load(id)));

// ✗ sequential loop by hand: each await yields, dispatch fires first, one batch each → N queries
for (const id of ids) await loader.load(id);
```

The GraphQL resolver pattern where each field does its own `await load()` is safe: the engine calls sibling resolvers concurrently, so every load is in the same turn. The only thing that breaks batching is a **sequential loop written by hand**.

---

## Back to the Wishlist

How do you query the heart icons for 20 listings? A batch API:

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

One call, O(1) requests. The backend uses DataLoader inside:

```ts
// the resolver code does not change
const wishlistInfo = await req.loaders.wishlist.load(listing.id);

// inside the DataLoader
const createWishlistLoader = (currentUserId) => new DataLoader(async (listingIds) => {
  const rows = await db.query(`
    SELECT wi.listing_id, wi.wishlist_id
    FROM wishlist_items wi
    JOIN wishlists w ON w.id = wi.wishlist_id   -- wishlist_items has no user_id, so ask wishlists
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

Wishlist status for 20 listings = 1 DB query.

This loader has to be created fresh for every HTTP request. Its closure holds `currentUserId`, and the built-in cache should only be valid within this one request. In NestJS, build it with REQUEST scope or in the GraphQL context. In Express, attach it in a middleware:

```ts
app.use((req, res, next) => {
  req.loaders = { wishlist: createWishlistLoader(req.user.id) };
  next();
});
```

<details>
<summary><strong>Where a batch function goes wrong: return order, one-to-many, cache scope</strong> (open this when you implement your own)</summary>

**The return order has to line up with the input.** The rows the DB returns are not guaranteed to be in the same order as `ids`, and the length is not guaranteed either (an id that is not found has no row). With a plain `return rows`, `.load(7)` gets someone else's data:

```ts
// ❌ returning rows directly, order is scrambled
return rows;

// ✅ realign to the order of ids, fill null for the ones not found
const map = new Map(rows.map(r => [r.id, r]));
return ids.map(id => map.get(id) ?? null);
```

DataLoader maps the batch result back to the `.load()` promises by input order, so the i-th result must be the answer for the i-th id.

**One-to-many needs your own grouping.** One `listing_id` can match several `wishlist_items` rows. The `map.set(r.listing_id, list)` loop above is doing the group by. It returns an array, not a single row, and fills `[]` rather than `null` for the ones not found.

**The cache is only valid within this request.** Call `.load(101)` twice in the same turn, and the second call gets the same promise directly, with no second DB query:

```ts
const a = loaders.wishlist.load(101);
const b = loaders.wishlist.load(101);
// a === b (the same promise)
```

Share one instance across requests, and alice's saved listings get cached for bob. In one request, a key loaded before a write and loaded again after it also returns the old value. That needs `loader.clear(key)`, covered in the "When you will regret it" section at the end.

</details>

---

## API design: actions, not overwrites

A newcomer's first instinct for the wishlist API:

```ts
PUT /api/wishlists/:id
{ "listings": ["listing-1", "listing-2", "listing-5"] }
```

**Race condition**: device A reads `[1,2,3]`, adds 4, sends `[1,2,3,4]`. Device B reads `[1,2,3]` at the same time, adds 5, sends `[1,2,3,5]`. **The later one overwrites the earlier one**.

So change it to send one action at a time (add one or remove one), instead of overwriting the whole list every time:

```ts
POST   /api/wishlists/:id/listings              // add one
DELETE /api/wishlists/:id/listings/:listingId    // remove one
```

Each action is independently idempotent. The DB uses `(wishlist_id, listing_id)` as a composite PK and the INSERT carries `ON CONFLICT DO NOTHING`, so a duplicate add is a no-op.

**Does this request express "the final state I want", or "the action I want to take right now"?** A wishlist is the latter. An overwrite style API fits form submissions and config files, where the user decides everything in one go.

---

## Click the heart and wait 200ms before it turns red: optimistic update

The API is designed, but the frontend still has a problem. Between the heart click and the server response there are 200ms:

```text
0ms    user clicks the heart
0ms    UI still shows a white heart (waiting for the API)
200ms  API returns, UI turns red
```

A 200ms pause. Scroll around the search page, click a few times, and every click stutters. It is annoying to use.

[Optimistic update](chunk://optimistic-update): change the UI first, assume success, roll back only on failure.

```ts
function toggleWishlist(listingId) {
  setIsWishlisted(true);  // turns red right away

  api.add(listingId).catch(() => {
    setIsWishlisted(false);  // roll back on failure
    toast('Save failed, please try again');
  });
}
```

Done together with the client cache (React Query / SWR / Zustand):

```ts
// 1. change the client cache directly
queryClient.setQueryData(['wishlist', userId], (old) => [...old, listingId]);

// 2. call the API
mutation.mutate(listingId, {
  onError: () => {
    // 3. roll back the cache
    queryClient.setQueryData(['wishlist', userId], (old) =>
      old.filter(id => id !== listingId)
    );
  },
  onSettled: () => {
    // 4. finally sync with the server once (to be safe)
    queryClient.invalidateQueries(['wishlist', userId]);
  },
});
```

Scroll to page two and back, and the client cache already holds the red heart state. **No need to call the API and ask the server again**. Frontend cache + optimistic update means the user never feels the latency of waiting for the server.

---

## DB and cache design

### Schema

```text
user ──< wishlists ──< wishlist_items >── listings
        many named lists   many-to-many
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

Put a few rows in and the division of work between the three tables becomes visible:

`listings`

| id | name |
|---|---|
| L1 | Paris attic |
| L2 | Kyoto machiya |
| L3 | Iceland cabin |

`wishlists`

| id | user_id | name |
|---|---|---|
| W1 | alice | Summer in Europe |
| W2 | alice | Winter northern lights |
| W3 | bob | Just browsing |

`wishlist_items`

| wishlist_id | listing_id |
|---|---|
| W1 | L1 |
| W2 | L1 |
| W1 | L3 |
| W3 | L2 |

alice's search page lays out three cards, L1, L2, L3. The correct result: L1 red heart, in two of her lists; L3 red heart, in one; L2 white heart, because bob is the one who saved it.

`wishlist_items` has only `wishlist_id` and `listing_id`. W1, W2 and W3 look exactly the same in this table, with no sign of whose they are. So the condition "only alice's" cannot be written here. You first have to ask `wishlists` who each W belongs to:

```sql
SELECT wi.listing_id, COUNT(*) AS in_n_lists
FROM wishlist_items wi
JOIN wishlists w ON w.id = wi.wishlist_id   -- attach user_id to each row
WHERE w.user_id = $1                        -- only now can bob's W3 be filtered out
  AND wi.listing_id IN ($2, $3, ...)        -- the 20 listings on this page
GROUP BY wi.listing_id;                     -- merge the rows for one listing into one, and count how many lists it is in
```

The result that comes back:

| listing_id | in_n_lists |
|---|---:|
| L1 | 2 |
| L3 | 1 |

L2 does not appear in the result, so the frontend gives it a white heart. `$1` comes from the login identity of this request. `IN (...)` comes from the batch of ids DataLoader collected.

To skip this join, store a copy of `user_id` in `wishlist_items` too, and index `(user_id, listing_id)` directly. The cost is one fact stored twice: when a list changes owner, both places have to change. This schema does not go that way, because there is a Redis layer in front of the search page (the cache section below).

### Should the heart get its own likes table

Should the heart on the search page have its own table? This has to be decided on the day the schema is written. Changing it after launch means migrating data.

**Merged (what this version chose)**: no likes table. A red heart = a row in `wishlist_items`, one source of truth. The cost: clicking the heart **must** decide which list it goes into, so the UI has to pop up "save to which wishlist", or put it into a default list first and let the user move it. Airbnb goes this way.

**Separate**: open a separate `likes(user_id, listing_id)`. One click on the heart adds it, no list to choose, and the wishlist is a separate, more deliberate organizing step. IG/Twitter likes and Pinterest's quick save lean this way. The cost is two tables, two sources of truth, and you have to define what state "liked but in no wishlist" and "in a wishlist but not liked" each count as.

If "saving" is itself the core action and the user is going to sort things into categories anyway (Airbnb's trip planning), merged is cleanest: one table fewer, one kind of inconsistency fewer. If a "like" is only a light signal, and "add to list" is an intent of a different strength (e-commerce "want this" vs "price comparison list"), only separate tables can record the two intents separately.

**When you will regret it**: after choosing merged, the day the product wants "like quickly, sort later" you get stuck, because the heart is always tied to a list. At that point, add an "Uncategorized" default list to cover it first, and split out a likes table only when it is really needed. No need to maintain an extra table from day one for that possibility.

### Why SQL and not NoSQL

- Fixed schema (name, user_id, items)
- Many-to-many (one listing can be in many wishlists)
- Read/write ratio 100:1, SQL plus one cache layer is enough
- No need for a flexible schema

### Cache: many reads, few writes, so add a Redis layer in front

```text
Redis:
  key: user:{userId}:wishlisted_listings
  value: Set<listingId>
  TTL: 10 min
```

When the search results page calls `/wishlists/check`, it checks Redis first and only queries the DB on a miss. Adding or removing a listing updates the cache at the same time (write-through).

Cross-device sync: add to a wishlist on the phone, and the computer has to see it. It does not need to be real-time (this is not a chat room). Eventual consistency is enough:

- Cache TTL 10 min → visible after at most 10 minutes
- Opening a wishlist to see its listings forces a refetch (bypass the cache)
- Optimistic update applies only on the current device; other devices wait for the cache to expire

---

## Edge cases

| Scenario | Handling |
|---|---|
| Listing taken down but still in a wishlist | Show "This listing is no longer available", do not delete automatically (the user may want to keep the record) |
| Network failure while adding | Optimistic rollback + toast |
| One listing in several wishlists | The `/check` API returns an array of wishlist IDs |
| Wishlist with too many listings (500+) | Load in pages, cursor pagination |
| Concurrent add/remove of the same item | The DB's PK constraint rejects duplicates; removal uses DELETE, a no-op if the row does not exist |
| Deleting a wishlist | CASCADE deletes the wishlist_items |
| Heart clicked while logged out | Redirect to the login page, with an intent param in the URL `?wishlist_action=add&listing=123` |

---

## Decision scenario

Same feature. When is DataLoader not needed?

If the N+1 happens in an endpoint loop you control, you do not need it. All the ids are in your hands. Collect them and send one `IN`:

```ts
const listings = await db.listings.findMany({ limit: 20 });
const ids = listings.map(l => l.id);              // ← there is one place to collect all the ids
const saved = await db.wishlistItems.findMany({ where: { listing_id: { in: ids } } });
```

DB queries go from 21 to 2, 105ms down to 13ms (5ms for the listing query plus 8ms for the `IN` query), with no library added.

Once the requirement becomes "in N of your wishlists", this approach no longer works. This time the lookups are scattered across the GraphQL field resolvers, and each resolver only has its own one listing:

```ts
@ResolveField()
wishlistCount(@Parent() listing) {
  // only the current listing is available; there is nowhere to collect the 20 ids first
  return loaders.wishlistCount.load(listing.id);
}
```

DataLoader supplies that collection point. Both ways end with the same result (one `IN` statement). The difference is whether the ids are collected by hand or automatically. So the question is whether you can find one place to collect all the ids. If you can, collect them yourself. Only if you cannot do you need DataLoader.

The 200 milliseconds on the frontend is a separate matter. That is the whole span from the heart click to the API response, network round trip included. It does not disappear because the queries went from 21 to 2. Only an [optimistic update](chunk://optimistic-update) spares the user the wait.

### When you will regret it

DataLoader's per-request cache is a good thing in most situations, but one case goes wrong: in one request, if a key was loaded before a write, loading it again after the write returns the value from before the write, straight from the cache.

```ts
// in the same mutation operation, root fields run in order
mutation {
  before: me { wishlistCount }  // read: first load, DB returns 3, the result is cached
  addToWishlist(...) { id }     // write: DB becomes 4
  after: me { wishlistCount }   // read: same key, gets the cached 3
}
```

Nothing goes wrong if the key was not loaded before the write. Remove the `before` line and `after` becomes the first load, so it queries the DB and gets 4. In practice it is usually a resolver that read first, for example `addToWishlist` loading the count once to check the wishlist limit.

The fix is to call `loader.clear(key)` or `loader.clearAll()` after the mutation.

Optimistic update is regretted when **the action cannot be undone**. A wrong wishlist add rolls back with no harm. But for actions like "send message" or "place order", if the screen shows "sent" first and the action then fails, the user feels deceived.
