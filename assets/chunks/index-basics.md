---
title: "Index 基礎"
slug: index-basics
brief: "沒有 index 就全表掃描。有了 index，查詢走 B+ Tree，幾億筆資料 3-4 次 IO 找到。"
date: 2026-03-28
updated: 2026-07-20
revisions: 2
---

# Index 基礎

沒有 index，查詢就是全表掃描：從第一筆 row 掃到最後一筆，找出符合條件的。一億筆資料掃一億次。

Index 是另外建一棵 B+ Tree，用來加速查詢。

## B+ Tree 的結構

資料只存在 leaf node（最底層），internal node 只存 key 用來導航。每個 node 是一個 page（通常 16KB），可以放幾百個 key。

```text
         [50]
        /    \
    [20,30]  [70,90]
    /  |  \    |   \
[..][..][..]  [..] [..] ← leaf，資料在這裡
```

樹深通常 3-4 層，幾億筆資料最多 4 次 IO 就找到。

## Primary vs Secondary Index

**Primary index（PK）**：每張表只有一個，建表時自動建立。

**Secondary index**：手動建，可以有很多個。

```sql
CREATE INDEX ON users(email);    -- secondary
CREATE INDEX ON orders(user_id); -- secondary
```

兩者的差別在 leaf 存的東西：

```text
Primary index leaf：
  id=1 → { name="Alice", email="a@x.com", ... }（整筆 row 或指向 row 的位置）

Secondary index leaf：
  email="a@x.com" → id=1（只存 PK，不存整筆 row）
```

查 secondary index 找到 email、拿到 PK 後，還要再回 primary index 撈一次才拿到完整 row。所以是兩步：secondary 找 PK，primary 拿整筆。

這個「再查一次」的代價，就是 clustered index 要解決的問題。

## 實務細節

**Covering index**：不是特殊的 index 類型，是一種狀態——當查詢需要的欄位剛好都在 index 裡，這個 index 對這個查詢來說就是 covering。不用回 table 再拿一次。展開（含 composite index 的欄位順序）拆在 [Covering Index](chunk://covering-index)。
