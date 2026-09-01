---
title: "Covering Index"
slug: covering-index
brief: "查詢要的欄位剛好都在 index 裡就不用回 table；composite index 的欄位順序決定誰用得上它。"
date: 2026-07-20
---

# Covering Index

不是特殊的 index 類型，是一種狀態：當查詢需要的欄位剛好都在 index 裡，這個 index 對這個查詢來說就是 covering。不用回 table 再拿一次。

```sql
CREATE INDEX ON users(email, name);

SELECT name FROM users WHERE email = 'a@x.com';
-- email、name 都在 index 裡 → covering，一步完成

SELECT * FROM users WHERE email = 'a@x.com';
-- * 包含其他欄位，index 不夠 → 還是要回 table
```

## Composite index 的欄位順序

`(email, name)` 和 `(name, email)` 是不同的 index。B+ Tree 先按第一個欄位排序，再按第二個。查詢要從最左欄位開始用，沒有最左欄位就無法走這個 index。

```text
index on (tenant_id, created_at)

WHERE tenant_id = 'acme'                    → 走 index（有最左欄位）
WHERE tenant_id = 'acme' AND created_at > x → 走 index
WHERE created_at > x                        → 走不了這個 index，退回全表掃描
```

實務上把「過濾性最強的欄位」放最左。`tenant_id` 一個值就能把資料縮小到一個 tenant 的範圍，`created_at` 在這個範圍內再排序。反過來放的話，B+ Tree 要先掃所有 tenant 的時間，沒有意義。

## 代價

每次 INSERT / UPDATE / DELETE，所有相關 index 都要跟著更新。三個 index 就更新三次 B+ Tree。想靠加欄位讓更多查詢 covering，寫入就更慢。Index 不是建越多越好，要按查詢模式選。
