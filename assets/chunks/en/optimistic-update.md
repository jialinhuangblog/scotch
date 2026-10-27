---
title: "Optimistic UI Update"
slug: optimistic-update
brief: "Change the UI first, then call the API. Roll back on failure. The user never feels the 200ms network round trip."
date: 2026-04-28
updated: 2026-07-20
revisions: 1
article: wishlist-dataloader
---

# Optimistic UI Update

> The heart turns red 200ms after the click, and the user feels the lag. But how do you know the result before the API comes back?

## The scene

The Airbnb wishlist heart icon. Clicking it adds the listing to a wishlist. The network round trip is 200ms:

```text
0ms    user clicks heart
0ms    UI still shows a white heart (waiting for the API)
200ms  API returns, UI turns red
```

To the user, 200ms is "it paused before reacting". Scrolling through search results and clicking hearts, every click stutters. It gets annoying.

## Optimistic: change the UI first, assume success

```ts
function toggleWishlist(listingId) {
  // 1. change the UI right away
  setIsWishlisted(true);

  // 2. call the API in the background
  api.add(listingId).catch((err) => {
    // 3. roll back only on failure
    setIsWishlisted(false);
    toast('Save failed, please retry');
  });
}
```

```text
0ms    user clicks heart
0ms    UI turns red right away
200ms  API succeeds → nothing changes
       API fails → roll back to white heart + toast
```

**In the normal case the user sees an instant reaction.** Only on failure is there a brief UI flicker.

## Where the name comes from: optimistic vs pessimistic

"Optimistic" comes from **optimistic / pessimistic locking** in concurrency control:

- **Pessimistic**: assume a conflict will happen, take a lock before doing anything (`SELECT ... FOR UPDATE`), and everyone else waits for the lock to be released. In UI terms, this is the baseline above: **change the screen only after the server confirms**, the white heart spins until the API returns.
- **Optimistic**: assume conflicts are rare, take no lock, and only at commit time check with a version / ETag whether someone else changed it first; if so, retry. In UI terms, this is changing the screen first, betting it will succeed, and rolling back only on failure.

So an optimistic update is the optimistic lock's "do it first, undo on failure" approach applied to the UI.

## Preconditions

- **Low failure rate**: 99% succeed, 1% roll back is an acceptable cost
- **Affordable failure**: a UI rollback loses no data and causes no chain of errors
- **Reversible action**: the UI change can be undone

Where it does not fit: payments and charges, sending a message, destructive actions that cannot be undone. Those wait for the server response before changing the UI.

## Relationship to the server side

An optimistic update happens only on the **frontend**; the server side does not know about it. The server still does everything it should:

- The server **must not** validate less because the client is optimistic
- Race conditions (two devices changing at the same time) are the server's job: use "action" APIs (POST add / DELETE remove) instead of "overwrite the whole thing" (PUT the entire array)
- When the server returns a failure, the client rolls back on its own
