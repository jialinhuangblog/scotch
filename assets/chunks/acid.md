---
title: "ACID"
slug: acid
brief: "Transaction 的四個保證，每個字母怎麼實現都不一樣。"
date: 2026-03-16
article: storage-deep
---

# ACID（Atomicity, Consistency, Isolation, Durability）

> 通用概念。MySQL（InnoDB）、PostgreSQL、SQL Server、Oracle 都支援 ACID。大部分 NoSQL（Cassandra、Redis）不支援完整 ACID。MongoDB 4.0+ 開始支援多文件 transaction。

> 這個 chunk 是入口。讀完後依序看：WAL（D 怎麼實現）→ MVCC（I 怎麼實現）→ Isolation Levels（I 的程度控制）。

Transaction 就是「這幾筆操作要嘛全部成功，要嘛全部不做」。ACID 是 transaction 的四個保證。只有 RDB 和少數 NoSQL（MongoDB 4.0+）支援完整 ACID，因為 transaction 需要統一的寫入順序，而 leaderless 架構（Cassandra、DynamoDB）做不到。

## A — Atomicity（原子性）

一個 transaction 裡的操作，全做或全不做。

場景：轉帳。A 扣 100 元，B 加 100 元。如果扣了 A 但寫 B 的時候斷電，A 的錢就憑空消失了。

Atomicity 保證：斷電了就全部 rollback，A 的 100 元回來。

**靠什麼實現？** Undo log。每筆操作執行前，先記錄「怎麼還原」。需要 rollback 時，沿著 undo log 反向執行。

```text
UPDATE 前，先把舊值抄一份進 undo log：

  資料現況            undo log（怎麼還原）
  A = 100  ──改成 0──►  記著「A 原本是 100」
                              ▲
  斷電 / 出錯 / ROLLBACK ─────┘
  → 照 undo log 把 A 寫回 100，像這筆從沒發生過
```

## C — Consistency（一致性）

資料永遠符合定義的規則。DB 會自己把違規的擋下來，例如 foreign key 指到不存在的 row、或 unique 欄位撞了。

這個 C 跟 CAP 的 C 不同：
- **ACID 的 C**：資料符合 schema 規則（constraint、trigger）
- **CAP 的 C**：所有節點看到同一份資料

**靠什麼實現？** Constraint 和 trigger。是 DB 的規則引擎，不是特定機制。

## I — Isolation（隔離性）

兩個 transaction 同時跑，互相看不到對方寫到一半的資料。

場景：Transaction A 在讀 orders 表，Transaction B 同時在改 orders 表。沒有 isolation 的話，A 可能讀到 B 改到一半的資料。

**靠什麼實現？** MVCC（Multi-Version Concurrency Control）。UPDATE 不覆蓋舊值，而是產生新版本。A 繼續看舊版本，B 建立新版本。讀不擋寫，寫不擋讀。

Isolation 有程度之分，由 Isolation Level 控制：

| Level | 看到什麼 | 效能 |
|---|---|---|
| Read Uncommitted | 看得到別人寫到一半的 | 最快，最危險 |
| Read Committed | 只看到別人 commit 過的 | PostgreSQL 預設 |
| Repeatable Read | 整個 transaction 期間看到同一份 snapshot | MySQL InnoDB 預設 |
| Serializable | 完全隔離，像一個一個排隊執行 | 最安全，最慢 |

## D — Durability（持久性）

Commit 之後，即使馬上斷電，資料也不會丟。

**靠什麼實現？** [WAL](chunk://wal)（Write-Ahead Log）。commit 時先把改動寫進 WAL（sequential write，fsync 到磁碟），再回覆 client。真正改 B+ Tree page 的事之後慢慢做。斷電了？重啟後讀 WAL 重放。

## 哪個字母對應哪個機制

| 字母 | 保證 | 靠什麼實現 |
|---|---|---|
| A — Atomicity | 全做或全不做 | Undo log（反向還原） |
| C — Consistency | 資料符合規則 | Constraint / Trigger |
| I — Isolation | Transaction 之間互不干擾 | MVCC + Isolation Levels |
| D — Durability | Commit 後不丟 | WAL（先寫 log 再改資料） |

---

ACID 拆開來是四個不同的保證，各管一塊、各自用不同機制實現。
