---
title: "Optimistic UI Update"
slug: optimistic-update
brief: "先改 UI 再打 API。失敗就 rollback。讓使用者感覺不到那 200ms 的網路往返。"
date: 2026-04-28
updated: 2026-07-20
revisions: 1
article: wishlist-dataloader
---

# Optimistic UI Update

> 點 heart 後 200ms 才變紅，使用者覺得卡。但 API 還沒回來怎麼知道結果？

## 場景

Airbnb wishlist heart icon。點下去要把 listing 加進 wishlist。網路 round-trip 200ms：

```text
0ms    user 點 heart
0ms    UI 還是白心（等 API）
200ms  API 回來，UI 變紅
```

200ms 對使用者是「卡了一下才有反應」。在搜尋結果頁滑來滑去點 heart，每次都頓一下，用起來很煩。

## Optimistic：先改 UI，假設成功

```ts
function toggleWishlist(listingId) {
  // 1. 立刻改 UI
  setIsWishlisted(true);

  // 2. 背景打 API
  api.add(listingId).catch((err) => {
    // 3. 失敗才 rollback
    setIsWishlisted(false);
    toast('儲存失敗，請重試');
  });
}
```

```text
0ms    user 點 heart
0ms    UI 立刻變紅
200ms  API 成功 → 不動
       API 失敗 → rollback 回白心 + toast
```

**正常情況下 user 看到瞬間反應**。失敗才有短暫 UI 跳動。

## 名字從哪來：樂觀 vs 悲觀

「Optimistic」這個名字來自並發控制的 **optimistic / pessimistic locking**：

- **悲觀（pessimistic）**：假設衝突一定會發生，動手前先上鎖（`SELECT ... FOR UPDATE`），別人卡住等你。對應到 UI，就是上面那個 baseline：**等 server 確認了才改畫面**，白心一直轉到 API 回來。穩，但要等。
- **樂觀（optimistic）**：假設衝突很少，不鎖，改完要 commit 時才用 version / ETag 檢查有沒有人插隊，被插隊就 retry。對應到 UI，就是先改畫面、賭它會成功，失敗才 rollback。

所以 optimistic update 是把「樂觀鎖」那套賭注搬到 UX 上。API 常見的 Version / ETag 檢查，就是樂觀鎖本人。

## 適用前提

- **失敗率低**：99% 都會成功，1% rollback 是可接受的代價
- **失敗成本可承受**：UI rollback 不會丟資料、不會造成連鎖錯誤
- **操作可逆**：UI 改了能復原回去

不適合的場景：付款扣款、發訊息、不可逆的破壞動作。這種要等 server 回應再改 UI。

## 跟 Server-side 的關係

optimistic update 是**前端動的一個小手腳**，server-side 不知道。Server 該做的還是要做：

- Server **不能**因為 client 是 optimistic 就少做驗證
- Race condition（兩個 device 同時改）由 server 解：用「動作」API（POST add / DELETE remove）而不是「整包覆寫」（PUT 整個 array）
- Server 回失敗，client 自己 rollback

---

Optimistic update 把「server 是唯一真相」這個事實藏在背景。代價是偶爾 rollback 跳一下，換來絕大多數時候的即時感。
