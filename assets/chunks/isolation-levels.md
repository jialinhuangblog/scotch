---
title: "Isolation Levels"
slug: isolation-levels
brief: "Read committed、repeatable read、serializable。等級越高，防掉的異常越多，並行度越低。"
date: 2026-06-12
updated: 2026-10-18
revisions: 3
article: storage-deep
---

# Isolation Levels

> 兩個 transaction 同時跑，要互相隔離到什麼程度？隔得越乾淨越安全，但也越慢。

## 沒有隔離時會讀到什麼

拿一個帳戶走一遍。帳戶 A 餘額 1000 元。T1 是一筆轉帳，T2 是對帳報表，兩個同時開始。

```text
T1: BEGIN                              T2: BEGIN
T1: UPDATE A 餘額 = 1000 - 300
                                       T2: SELECT A 餘額   → 700？還是 1000？
T1: ROLLBACK，轉帳失敗，餘額回到 1000
                                       T2: SELECT A 餘額   → 1000
```

T2 第一次要是讀到 700，就是讀到了 T1 還沒 commit 的改動，這叫 dirty read。T1 後來 rollback，700 這個數字從來沒有真的存在過，報表卻把它算進去了。

就算擋掉 dirty read，T2 前後兩次讀同一筆還是可能不一樣。把劇本改成 T1 正常 commit，T2 第一次讀到 1000，第二次讀到 700。同一個 transaction 裡同一筆 row 讀兩次值不同，這叫 non-repeatable read，報表前半段用 1000 算、後半段用 700 算，兩半對不起來。

第三種跟範圍有關。T2 跑 `SELECT count(*) FROM accounts WHERE balance > 500` 得到 10 筆，中間 T1 新開了一個餘額 800 的帳戶並 commit，T2 再跑一次變 11 筆。原本的每一筆 row 都沒變，但範圍查詢多出一筆，這叫 phantom read。

## 四個等級，越往下防掉的越多

| 等級 | 防掉 | 還會發生 |
|---|---|---|
| **Read Uncommitted** | 都防不了 | dirty read 都可能 |
| **Read Committed** | dirty read | non-repeatable、phantom |
| **Repeatable Read** | dirty + non-repeatable | phantom（標準上會；PostgreSQL 不會；MySQL InnoDB 只有一直用一般 SELECT 讀的時候不會，見下文） |
| **Serializable** | 全部 | 無，像 transaction 一個一個排隊跑 |

往下走比較安全，可是也比較慢。Read committed 跟 repeatable read 都靠 [MVCC](chunk://mvcc) 讓 T2 讀舊版本，不用等 T1 放鎖。差別在 read committed 每一次 SELECT 都讀當下最新 commit 的版本，所以會先 1000 後 700；repeatable read 在 T2 第一次讀取時拍一張快照，之後整個 transaction 都讀這一張，所以 T2 兩次都讀到 1000。快照不是在 BEGIN 那一刻拍的。T2 要是 BEGIN 之後隔了一陣子才第一次 SELECT，中間 T1 已經 commit 的 700 就會讀到。PostgreSQL 在 BEGIN 之後的第一句 SQL 執行時拍，MySQL 在第一次一般 SELECT 時拍；MySQL 想在 BEGIN 當下就拍，要寫 `START TRANSACTION WITH CONSISTENT SNAPSHOT`。Serializable 要鎖範圍或偵測衝突後重跑，並行度掉很多。

MySQL 的例外，拿上面 phantom 的劇本跑一次就會出現。T2 在 repeatable read 下 count 得到 10 筆，T1 新開一個餘額 800 的帳戶並 commit，T2 再 count 一次還是 10 筆，到這裡跟 PostgreSQL 一樣。可是 T2 要是在兩次 count 中間跑一句 `UPDATE accounts SET ... WHERE balance > 500`，MySQL 的 UPDATE 不讀快照，讀的是當下最新 commit 的 row，所以 T1 那個新帳戶也一起改到。改過之後那一筆就是 T2 自己寫的版本，第二次 count 變成 11 筆。同一個劇本換到 PostgreSQL，UPDATE 只改快照裡那 10 筆，第二次 count 還是 10。InnoDB 的 next-key lock 只在 UPDATE、DELETE、`SELECT ... FOR UPDATE` 這類會上鎖的讀取時鎖住範圍，T2 第一次 count 用的是一般 SELECT，不上鎖，所以 T1 的 INSERT 不用等，直接寫入。

像一份共用的 Google Doc：read uncommitted 是讀得到別人正在打、還沒存的字；read committed 只讀得到存檔後的版本；repeatable read 是第一次看內容的那一刻畫面就 freeze，之後整段時間都看那一版；serializable 是大家排隊輪流改，不准同時改。

## 預設值

Postgres 預設 **Read Committed**，MySQL InnoDB 預設 **Repeatable Read**。預設不是最安全的那檔，是在「夠安全」跟「夠快」之間的折衷。需要更強的一致性才手動調高。
