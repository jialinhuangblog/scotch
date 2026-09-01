---
title: "Isolation Levels"
slug: isolation-levels
brief: "Read committed、repeatable read、serializable。各有代價。"
date: 2026-06-12
article: storage-deep
---

# Isolation Levels

> 兩個 transaction 同時跑，要互相隔離到什麼程度？隔得越乾淨越安全，但也越慢。

## 沒隔離會出三種怪事

兩個 transaction 並行時，如果完全不隔離，會看到對方寫到一半的東西，依嚴重程度分三種：

- **Dirty read**：讀到對方**還沒 commit** 的改動。對方等下 rollback，你就讀到一筆從來不存在的資料。
- **Non-repeatable read**：同一筆 row 在你的 transaction 裡讀兩次，值不一樣（中間別人 commit 了 update）。
- **Phantom read**：同一個範圍查詢（`WHERE age > 30`）跑兩次，回來的 row 數不一樣（中間別人插入或刪除了符合條件的 row）。

## 四個等級，越往下擋得越多

| 等級 | 擋掉 | 還會發生 |
|---|---|---|
| **Read Uncommitted** | 什麼都不擋 | dirty read 都可能 |
| **Read Committed** | dirty read | non-repeatable、phantom |
| **Repeatable Read** | dirty + non-repeatable | phantom（標準上會，MySQL InnoDB 用 gap lock 連 phantom 也擋掉） |
| **Serializable** | 全部 | 無，像 transaction 一個一個排隊跑 |

往下走比較安全，可是也比較慢：低等級靠 [MVCC](chunk://mvcc) snapshot 讀舊版本、不太擋；serializable 要鎖範圍或偵測衝突重跑，並行度掉很多。

像一份共用的 Google Doc：read uncommitted 是看得到別人正在打、還沒存的字；read committed 只看得到存檔後的版本；repeatable read 是你打開的那一刻畫面凍住、整段時間都看同一版；serializable 是大家排隊輪流改，不准同時。

## 預設值

Postgres 預設 **Read Committed**，MySQL InnoDB 預設 **Repeatable Read**。預設不是最安全的那檔，是在「夠安全」跟「夠快」之間的折衷。需要更強的一致性才手動調高。

---

isolation level 決定你為了並行速度願意忍受多少「讀到一半的資料」。越嚴越安全也越慢，實務上大多停在 read committed 或 repeatable read。
