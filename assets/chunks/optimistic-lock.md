---
title: "Optimistic Lock"
slug: optimistic-lock
brief: "不鎖，假設沒人同時修改。寫回時比對 version，發現被別人改過就重來。"
date: 2026-07-31
updated: 2026-09-01
revisions: 2
article: storage-deep
---

# Optimistic Lock（樂觀鎖）

> 同樣是兩個人同時改一列。悲觀鎖先鎖住，樂觀鎖相反：動手前不鎖，寫回時才檢查這段時間有沒有人先改過。

## version 欄位比對

表上多加一個 `version` 欄。讀出來的時候記住當時的 version，寫回時用它當條件。

```sql
-- 1. service 讀，不鎖
SELECT avg_rating, num_ratings, version FROM businesses WHERE id = 7;
-- → 4.0, 10, v42

-- 2. service 算出 4.09，把剛剛記住的 42 帶進 WHERE
UPDATE businesses
SET avg_rating = 4.09, num_ratings = 11, version = version + 1
WHERE id = 7 AND version = 42;
-- → DB 只回一個 affected rows

-- 3. service 看 affected rows 是 1 還是 0，自己決定重不重來
```

這兩句都是普通的 SELECT 跟 UPDATE，沒用到 DB 的任何鎖功能。DB 只保證單句 UPDATE 是原子的，`version = 42` 的比對跟寫入之間插不進別的 transaction。記住 42、算新值、看 affected rows、決定重試，全在 service / repository 層。

UPDATE 回傳的 affected rows：

- **影響 1 列**：這段時間沒人動過，version 還是 42，改成功，version 變 43。
- **影響 0 列**：有人搶先改了，version 已經是 43，`WHERE` 對不到任何列。DB 回傳「影響 0 列」，代表剛剛算出來的新值已經作廢。

## 自定義 retry 機制

DB 只給線索（影響 0 列），重來要應用層自己寫 loop。DB 不會自動重試，因為它不知道重試對這段邏輯安不安全。

```ts
async function addRating(id: number, stars: number) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await db.one(
      `SELECT avg_rating, num_ratings, version FROM businesses WHERE id = $1`,
      [id],
    );

    const numRatings = cur.num_ratings + 1;
    const avgRating = (cur.avg_rating * cur.num_ratings + stars) / numRatings;

    const { rowCount } = await db.query(
      `UPDATE businesses
          SET avg_rating = $1, num_ratings = $2, version = version + 1
        WHERE id = $3 AND version = $4`,
      [avgRating, numRatings, id, cur.version],
    );

    if (rowCount === 1) return;   // 成功，收工
    // rowCount === 0：被插隊，回頭重讀重算
  }
  throw new Error('too many conflicts');   // 上限用完，回錯誤給上層決定
}
```

重試要有**上限**，不然衝突高的時候會無限重試。上限用完後怎麼處理（回錯誤、丟 queue、降級）由應用層決定。ORM 會**偵測**衝突並丟出例外（例如 Hibernate 的 `@Version`），但 retry logic 還是要自己寫。

## 跟 MVCC 的差別

兩個都用「版本」，但在不同層：

- [MVCC](chunk://mvcc) 的版本是 DB 底層自己維護的列快照，應用層看不到，它讓讀取不必等寫入。上面那句 `SELECT` 不用鎖、重讀時能看到別人已經提交的新值，前提都是有 MVCC。
- 樂觀鎖的 `version` 是應用層自己加的欄位，比對也在應用層做。這層才叫樂觀鎖。

不想加欄位也行，可以拿現成的 `updated_at` 當版本號，或直接比對舊值本身（`WHERE avg_rating = 4.0 AND num_ratings = 10`）。做法都是在寫回時驗證資料還是讀出來時那個值。

## 前端的對應版本

[Optimistic UI update](chunk://optimistic-update)（點 heart 先變紅、失敗再 rollback）用的是同一套思路，只是搬到畫面上。API 常見的 Version / ETag 檢查，用的就是樂觀鎖。

## 什麼時候用

衝突少（99% 不衝突，1% 重試划算）、或不想鎖住列（例如這段邏輯前面還有慢的操作）。衝突高的時候樂觀鎖會一直重試，反而用 [pessimistic lock](chunk://pessimistic-lock) 讓後到的排隊，每筆只要算一次。

## 三種機制比較

| 機制 | 解決哪種衝突 | 佔位置嗎 | 誰實作 |
|---|---|---|---|
| [MVCC](chunk://mvcc) | 讀 vs 寫 | 不佔位置，讀舊版本快照 | DB 自動 |
| [悲觀鎖](chunk://pessimistic-lock) | 寫 vs 寫 | 事先佔位置，別人排隊 | DB 自動（UPDATE / FOR UPDATE） |
| [樂觀鎖](chunk://optimistic-lock) | 寫 vs 寫 | 不佔位置，寫回時比對 version | 應用層（version + retry） |

MVCC 不在悲觀跟樂觀這條軸上，它處理的是讀跟寫之間的衝突。寫跟寫衝突時才要在兩者之間選：衝突頻繁的話，排隊等比一直重試划算，所以用悲觀鎖；衝突很少的話，事先鎖住的成本大多白花，所以用樂觀鎖。
