---
title: "MVCC"
slug: mvcc
brief: "一行資料多個版本。讀不擋寫。"
date: 2026-03-15
updated: 2026-07-31
revisions: 2
article: storage-deep
---

# MVCC（Multi-Version Concurrency Control）

> 通用概念。InnoDB 和 PostgreSQL 都用 MVCC，但實作不同：InnoDB 用 undo log 存舊版本，PostgreSQL 把新舊版本都留在 heap。

UPDATE 一筆資料不會覆蓋原本的值，而是產生新版本。讀的人繼續看舊版本，寫的人建立新版本。讀不擋寫，寫不擋讀。

## 沒有 MVCC 的世界

最簡單的做法：讀寫都鎖。Transaction A 在讀某一行，Transaction B 要改這行就得等。反過來也一樣。

讀寫互卡，吞吐量大概少一半。

## 版本鏈

每一行資料帶一個隱藏的 transaction ID。UPDATE 時不改原本那行，而是插入一行新版本，指回舊版本。

```text
row (id=1):
  version 3: name="Carol"  ← 最新
    ↓ 指向
  version 2: name="Bob"
    ↓ 指向
  version 1: name="Alice"  ← 最舊
```

讀的時候，DB 根據當前 transaction 的 snapshot 決定看到哪個版本。開始得早的 transaction 看到舊版本，開始得晚的看到新版本。

## InnoDB：舊版本搬走

B+ Tree 的 leaf page 只保留最新版本。被覆蓋的舊版本搬到另一個地方，叫 undo log。

```text
B+ Tree leaf page:
  id=1, name="Carol"（最新版本）
         ↓ 指標指向 undo log
undo log:
  name="Bob"（上一版）→ name="Alice"（最早版）
```

讀取時，如果 transaction 開始得早，沿著指標往 undo log 找到該看的舊版本。

好處：B+ Tree 永遠乾淨，只有最新資料，查詢效率高。
壞處：undo log 要佔空間。如果有 transaction 長時間不 commit，undo log 就一直堆積，因為那些舊版本不能丟（還有人要看）。

## PostgreSQL：新舊版本放在一起

不搬走。UPDATE 時，舊版本留在原地，新版本也寫在同一個 page 裡。每一筆資料標記「誰建立了它」和「誰讓它過期」。

```text
同一個 page 裡:
  id=1, name="Alice" （已過期，等清理）
  id=1, name="Bob"   （已過期，等清理）
  id=1, name="Carol" （目前有效）
```

好處：不需要額外的 undo log，寫入比較單純。
壞處：過期的資料堆在 page 裡佔空間，查詢時要跳過它們。PostgreSQL 內建 autovacuum 會自動清理過期資料，騰出空間。

## 和 clustered index 的關係

這個實作差異決定了兩家 DB 的 [clustered index](chunk://clustered-index) 能不能做。InnoDB 的 undo log 設計讓 leaf page 永遠只有最新版本，所以資料可以住在 B+ Tree 裡按 PK 物理排序，clustered index 成立。PostgreSQL 的新舊版本都留在 heap 任意位置，物理順序本來就不穩定，clustered index 天然做不到。

換句話說，PostgreSQL 的 MVCC 因為每次 UPDATE 都把新版本寫到 heap 的任意空位，同一筆資料的物理位置一直在變，「按 key 物理排序」這個 clustered index 的前提就成立不了。也因為這樣，它做不到 clustered index。

## 三個放一起

MVCC 只解讀寫。兩個人同時**改**同一列，它救不了，那是 lock 的事：

| 機制 | 解決哪種衝突 | 佔位置嗎 | 誰實作 |
|---|---|---|---|
| [MVCC](chunk://mvcc) | 讀 vs 寫 | 不佔位置，讀舊版本快照 | DB 自動 |
| [悲觀鎖](chunk://pessimistic-lock) | 寫 vs 寫 | 事先佔位置，別人排隊 | DB 自動（UPDATE / FOR UPDATE） |
| [樂觀鎖](chunk://optimistic-lock) | 寫 vs 寫 | 不佔位置，寫回時比對 version | 應用層（version + retry） |

分界線是佔不佔位置。MVCC 不在悲觀樂觀這條軸上，它管讀寫解耦；寫寫衝突才分悲觀樂觀，悲觀用等待、樂觀用重試，衝突多走悲觀、少走樂觀。

---

MVCC 讓讀寫不互相阻塞。代價是舊版本要有人清理：InnoDB 清 undo log，PostgreSQL 跑 VACUUM。
