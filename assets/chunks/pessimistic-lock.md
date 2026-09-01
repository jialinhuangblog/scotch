---
title: "Pessimistic Lock"
slug: pessimistic-lock
brief: "假設一定會衝突，動手前先鎖住那一列。別人排隊等。"
date: 2026-07-31
article: storage-deep
---

# Pessimistic Lock（悲觀鎖）

> 兩個人同時給同一家店評分，avg_rating 怎麼保證不互蓋？悲觀鎖的答案：先鎖住，別人等。

## 問題：寫 vs 寫

[MVCC](chunk://mvcc) 管的是讀跟寫之間（讀的人看舊版本，不擋寫）。但兩個人同時**改**同一列，MVCC 沒辦法：世界只能有一個下一版，兩個都基於舊值算，後寫的覆蓋先寫的，先寫的那次更新等於沒發生。這叫 lost update。

## row lock：UPDATE 自動就拿

```sql
UPDATE businesses
SET avg_rating = (avg_rating * num_ratings + 5) / (num_ratings + 1),
    num_ratings = num_ratings + 1
WHERE id = 7;
```

這一句碰到 id=7 那列時，DB 自動幫它上 row lock，不用你寫任何鎖的語法。第二個要改同一列的人**排隊等**，等第一個 commit 放鎖，才拿到鎖、重讀到已更新的值再算。兩筆都正確累進。

悲觀鎖的做法就一句：**用等待取代失敗**。程式什麼額外邏輯都不用寫，上鎖、排隊、放鎖這些 DB 全部自己處理。

## SELECT ... FOR UPDATE：提前鎖住

row lock 是 UPDATE 碰到那列才拿。有時你要「在讀的時候就先鎖住，算完再寫」，中間不讓別人插手。經典場景是扣庫存：

```sql
BEGIN;
SELECT stock FROM products WHERE id = 7 FOR UPDATE;  -- 現在就鎖住
-- 應用層判斷 stock 夠不夠、算新值
UPDATE products SET stock = stock - 1 WHERE id = 7;
COMMIT;  -- 到這裡才放鎖
```

為什麼非要 FOR UPDATE？假設庫存剩 1 個，兩個人同時下單。沒有鎖的話，兩邊的 SELECT 都讀到 stock=1，都判斷「還有貨」，各自扣成 0，結果賣出 2 個，超賣。加上 FOR UPDATE，第一個人的 SELECT 就鎖住這一列，第二個人的 SELECT 排隊等；等第一個 commit（stock 已變 0），第二個才讀到 0，判斷「沒貨」，正確擋下。搶票是同一回事：先鎖住那個座位的列，兩個人才不會搶到同一個位子。

普通 `SELECT` 走 MVCC 快照，不鎖也不被鎖。加了 `FOR UPDATE`，這個 SELECT 就排進寫者的隊伍。

## 代價

- **鎖握到 COMMIT**：所以 transaction 要短。裡面別呼叫外部 API、別執行慢的操作，不然你握著鎖，別人全排在後面。
- **Deadlock**：A 鎖第 7 列等第 9 列，B 鎖第 9 列等第 7 列，互等。Postgres 會偵測到、挑一個 rollback。防法：多列更新時大家按同一順序鎖（例如都按 id 由小到大）。

## 什麼時候用

衝突頻繁、或不想在應用層寫重試邏輯時。另一條路是 [optimistic lock](chunk://optimistic-lock)：衝突少的時候，事先鎖住再等的成本就白花了，不如假設不會衝突、真的衝突了再重來。

同一列每秒被搶上千次，row lock 的隊伍排到滿，這時候連悲觀鎖也不划算，要改成 [write-behind](chunk://cache-strategies)：先在 Redis 累積，定期 flush back to DB，別讓每次都搶同一列的鎖。

## 三個放一起

| 機制 | 解決哪種衝突 | 佔位置嗎 | 誰實作 |
|---|---|---|---|
| [MVCC](chunk://mvcc) | 讀 vs 寫 | 不佔位置，讀舊版本快照 | DB 自動 |
| [悲觀鎖](chunk://pessimistic-lock) | 寫 vs 寫 | 事先佔位置，別人排隊 | DB 自動（UPDATE / FOR UPDATE） |
| [樂觀鎖](chunk://optimistic-lock) | 寫 vs 寫 | 不佔位置，寫回時比對 version | 應用層（version + retry） |

分界線是佔不佔位置。MVCC 不在悲觀樂觀這條軸上，它管讀寫解耦；寫寫衝突才分悲觀樂觀，悲觀用等待、樂觀用重試，衝突多走悲觀、少走樂觀。

---

悲觀鎖假設一定會衝突，先鎖住再做，別人排隊。DB 自動給，程式不用管，代價是握鎖期間別人全等著。
