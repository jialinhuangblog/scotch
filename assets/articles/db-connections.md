---
title: "DB 連線為什麼不能想開幾條就開幾條"
slug: db-connections
subtitle: "PostgreSQL 每條連線是一個 process，開太多整台就慢下來。這篇講 PgBouncer 跟它的 pooling mode 怎麼挑。"
chapter: "buffer"
tags: [postgresql, pgbouncer, connection-pooling, db-access-control, system-design-interview]
date: 2026-03-31
related: [pg-tradeoff, db-access-control, resource-pool-pattern, browser-connection-reuse]
---

# DB 連線為什麼不能想開幾條就開幾條

開發時連 DB 很簡單：填連線字串，框架自己連。但生產環境下，連線本身就是一個效能瓶頸。

---

## 為什麼連線很貴

同樣 100 條連線進來，PostgreSQL 和 MySQL 的反應完全不同。

PostgreSQL 每收到一條連線，就 fork 一個新的 OS process。每個 process 有自己獨立的記憶體空間，佔 5-10 MB RAM。

```text
100 條連線進 PostgreSQL：
  → fork 100 個 process
  → 每個 process 獨立 address space，5-10 MB
  → 總共 500 MB - 1 GB RAM，光是連線就吃掉了
  → OS 要在 100 個 process 之間做 context switch
```

為什麼有 context switch？一台機器的 CPU 核心數有限（通常 4-16 核），但同時有 100 個 process 要執行 query。OS 必須不斷切換：暫停 process A、儲存它的 register 和 memory mapping、載入 process B 的狀態、讓 B 跑一小段、再換下一個。這就是 context switch。Process 越多，CPU 花在「切換」的時間越多，花在「執行 query」的時間越少。就算 100 個 process 跑的 code 完全一樣，每個 process 有自己獨立的 address space，OS 切換時必須切 page table 和 TLB，這比 thread 之間切換貴得多。

MySQL 每收到一條連線，開一個 thread。Thread 共用同一個 process 的 address space，記憶體開銷小很多，切換也快。

```text
100 條連線進 MySQL：
  → 開 100 個 thread，都在同一個 process 裡
  → 共用 address space，每個 thread 只需要自己的 stack（通常幾百 KB）
  → context switch 在同一個 process 內，比 process 間切換快
```

所以 MySQL 開幾千條連線問題不大，PostgreSQL 開幾百條就開始痛。

### 為什麼不直接調大 max_connections

PostgreSQL 預設 `max_connections = 100`。直覺是調大就好，但效果遞減。

100 個 process 時，每條 query 排隊拿 lock、搶 CPU 的等待還可以接受。拉到 500 個 process，同一條 query 的 latency 可能從 2ms 膨脹到 8ms，因為 OS 花更多時間在 process 之間切換，而不是執行 query。連線數多了五倍，throughput 反而下降。

---

## 生產環境的連線量

```text
5 台 App Server × 每台 20 條連線 = 100 條
  → 剛好 max_connections 上限

加一台 server：
6 台 × 20 條 = 120 條
  → 超過上限，新連線被拒絕
  → 半夜 on-call 收到 alert
```

Serverless 更慘：

```text
AWS Lambda，每個 invocation 開一條連線
  → 瞬間 1,000 個併發 invocation
  → 1,000 條連線打到 PostgreSQL
  → PostgreSQL：死了
```

---

## PgBouncer：連線池

在 App 和 PostgreSQL 之間放一個 proxy，維護一個連線池。

```text
App Server A ─┐
App Server B ─┤→ PgBouncer（維護 20 條真連線）→ PostgreSQL
App Server C ─┘

100 條「假連線」共用 20 條「真連線」
```

App 跟 PgBouncer 建連線，幾乎零成本（PgBouncer 是 C 寫的，輕量級）。PgBouncer 從池子裡拿一條真的 DB 連線給 app 用，用完還回去，下一個 app 接著用。

---

## PgBouncer 偽裝成 PostgreSQL

PgBouncer 接手之後，ORM 的連線字串從 `host=db.internal port=5432` 變成 `host=pgbouncer.internal port=6543`。改一行 config，其他什麼都不用動。

ORM 或 driver 連線字串裡的 pool size（例如 `?pool_size=20`）控制的是 ORM 到 PgBouncer 的「假連線」數量，不是 PgBouncer 到 PostgreSQL 的「真連線」數量。PgBouncer 有自己的 `default_pool_size` 設定，決定它維護多少條真的 DB 連線。兩邊各管各的。ORM 覺得自己開了 20 條連線，PgBouncer 可能只用 5 條真連線在背後輪流服務。

這就是問題所在。ORM 不知道自己連的不是 PostgreSQL。對 ORM 來說，連線字串能連就好。它以為自己握的是一條真的 DB session。

```text
開發時（直連 PostgreSQL）：
  ORM → PostgreSQL
  一條連線 = 一個 session，SET 過的東西一直在

上線後（中間插了 PgBouncer）：
  ORM → PgBouncer → PostgreSQL
  ORM 以為自己還是直連，但背後的真連線可能每次 transaction 都在換
```

很多 ORM 在拿到連線時，會在 init hook 裡跑 `SET search_path`、`SET statement_timeout`、`SET timezone`。只跑一次，之後假設設定一直在。直連的時候這完全沒問題。

但 PgBouncer 在背後換了真連線，ORM 不知道，不會重新 SET。於是 `search_path` 靜默回到預設值，query 打到錯的 schema，不會報錯，結果就是錯的。

---

## 三種 Pooling Mode

問題不是「PgBouncer 會不會換連線」，而是「什麼時候換」。這就是 pooling mode 的定義。

### Transaction Mode（最常用）

一個 transaction 結束就把真連線還回池子。

```text
ORM 連到 PgBouncer（假連線，一直活著）
  → init hook: SET search_path = 'tenant_a' → 設在真連線 #7 上
  → BEGIN → INSERT → COMMIT → 真連線 #7 還回池子
  → 下一個 query → PgBouncer 給了真連線 #3
  → search_path 是預設值，ORM 不知道，不會重新 SET
```

一個 HTTP request 通常是一個 transaction，處理完連線馬上釋放。池的利用率高。但跨 transaction 的 session state 全部丟失：`SET` 的變數、`PREPARE` 的 statement、`LISTEN/NOTIFY` 的訂閱。

### Session Mode

整個 session 結束才還。ORM 斷開連線之前，真連線不會被換走。

```text
ORM 連上 → 拿到真連線 #7
  → SET timezone = 'Asia/Taipei'    ← 一直有效
  → Transaction 1: BEGIN → INSERT → COMMIT
  → Transaction 2: BEGIN → SELECT → COMMIT
  → PREPARE stmt AS SELECT ...      ← 一直有效
  → 斷開連線 → 真連線 #7 還回池子
```

`SET timezone` 什麼時候需要？PostgreSQL 內部存的 timestamp 是 UTC。`SET timezone = 'Asia/Taipei'` 讓 server 在回傳結果時自動把 UTC 轉成台北時間。多租戶 SaaS 裡，每個租戶可能在不同時區，server 端轉比 client 端轉更統一。如果你只存 `timestamptz` 且都在 application 層做時區轉換，就不需要 SET timezone，transaction mode 不會踩到這個坑。

功能最完整，行為跟直連一樣。代價是連線佔用時間最長，池的利用率最低。

### Statement Mode

一條 SQL 執行完就還。

```text
SELECT * FROM users → 拿 #7 → 執行完 → 還 #7
INSERT INTO orders → 拿 #3 → 執行完 → 還 #3
```

`BEGIN` 和 `COMMIT` 可能跑在不同連線上，所以 transaction 完全不能用。幾乎沒有生產場景會選這個。

### 怎麼選

| Mode | 換連線的時機 | 能用 transaction | 能用 SET / PREPARE | 池利用率 |
|---|---|---|---|---|
| Session | session 結束 | 能 | 能 | 低 |
| Transaction | transaction 結束 | 能 | 不能跨 transaction | 高 |
| Statement | 每條 SQL | 不能 | 不能 | 最高 |

大部分 Web 應用選 Transaction mode。一個 request = 一個 transaction，功能夠用，效能最好。如果 application code 沒有用 `SET`、`PREPARE`、`LISTEN/NOTIFY`，transaction mode 就是安全的預設選擇，不需要多想。

需要 `PREPARE`、`SET`、`LISTEN/NOTIFY` 的場景用 Session mode。切 mode 之前要盤點：application code 和 ORM 有沒有依賴 session-level state。有的話，不能用 transaction mode，或者要在每個 transaction 開頭補 SET。

---

## Session / Transaction / Statement：名詞釐清

這三個詞在不同場景下意思不同。

### 資料庫裡的 Session 和 Transaction

```text
Session：從連上 DB 到斷開的整個期間
  └── Transaction：BEGIN 到 COMMIT/ROLLBACK 的一段操作
       └── Statement：一條 SQL（SELECT / INSERT / ...）
```

一個 session 可以包含多個 transaction。一個 transaction 可以包含多條 statement。

```text
Session 開始（連上 DB）
  ├── SET timezone = 'Asia/Taipei'     ← session 層級的設定
  ├── Transaction 1
  │    ├── BEGIN
  │    ├── INSERT INTO orders ...      ← statement
  │    ├── UPDATE inventory ...        ← statement
  │    └── COMMIT
  ├── Transaction 2
  │    ├── BEGIN
  │    ├── SELECT * FROM orders        ← statement
  │    └── COMMIT
  └── Session 結束（斷開）
```

### PgBouncer 的 Pooling Mode

PgBouncer 的三種 mode 就是在這三個層級中選一個做切割點：

```text
Session mode:      切在 session 結束 → 整個 session 共用同一條 DB 連線
Transaction mode:  切在 transaction 結束 → 每個 transaction 可能用不同 DB 連線
Statement mode:    切在 statement 結束 → 每條 SQL 可能用不同 DB 連線
```

切得越細，連線釋放越快，池利用率越高，但能用的功能越少。

### 現實中的決策路徑

大部分團隊不是一開始就選 mode。是被逼到那裡的。

開發期直連 PostgreSQL，沒有 PgBouncer，不需要想 mode。上線後流量成長，連線數逼近 `max_connections`，開始拒絕連線。這時候才加 PgBouncer，預設 transaction mode，因為文件這樣寫，大部分教學也這樣推薦。

加完之後一切正常，直到某天發現多租戶的 `search_path` 偶爾打到錯的 schema，或者 `LISTEN/NOTIFY` 的即時通知莫名收不到。查了幾小時才發現問題不在 application code，而是 PgBouncer 在背後換了連線。

把一條真連線想成一張辦公桌，`SET search_path`、`SET timezone` 就是你調好的椅子高度。Transaction mode 是輪流坐：每個 transaction 坐到剛好空出來的那張桌子，做完還回去。你上一個 transaction 在 #7 桌調好的椅子，這個 transaction 坐到 #3，椅子是預設高度。設定不是「丟」了，是它留在你已經離開的那張桌子上。

這時候有兩條路：

```text
路線 A：留在 transaction mode，補 SET
  → 在每個 transaction 開頭重新 SET search_path / timezone
  → ORM 通常有 before_transaction hook 可以掛
  → 代價：每個 transaction 多一次 round trip

路線 B：退回 session mode
  → 行為跟直連一樣，SET 不會丟
  → 代價：池利用率下降，可能需要更多真連線
```

回到桌子：路線 A 是每次坐下都先重調一次椅子（每個 transaction 開頭補 SET），不管坐到哪張，調好再用。路線 B 是乾脆要一張自己的桌子坐一整天（session mode），椅子調一次就一直在，代價是這張桌子被你占著，別人能用的就少了。

大部分 Web API 走路線 A，因為一個 request 就是一個 transaction，補一次 SET 的成本可以接受。需要 `LISTEN/NOTIFY`（長連線等通知）或大量 `PREPARE` 的服務走路線 B，因為這些功能沒辦法靠「每次重新設」來解。

Statement mode 幾乎不會出現在這條路上。能用的場景太窄，遇到的團隊通常已經知道自己在做什麼。

---

## 雲端怎麼做

| 產品 | 連線池方案 | Pooling mode |
|---|---|---|
| Supabase | 內建 PgBouncer | Transaction mode（預設） |
| AWS RDS | RDS Proxy | 類似 Transaction mode |
| GCP Cloud SQL | Cloud SQL Proxy | 主要做認證，不做 pooling |
| Neon | 內建 connection pooler | Transaction mode |

Supabase 有兩個連線入口：

```text
port 5432 → 直連 PostgreSQL（Session mode，能用 PREPARE）
port 6543 → 經過 PgBouncer（Transaction mode，連線池）
```

一般 API 用 6543（pooling），需要 migration 或 PREPARE 用 5432（直連）。

---

---

PostgreSQL 每條連線都是一個 process，連線一多就吃不消。PgBouncer 在中間做連線池，讓幾百條「假連線」共用幾十條「真連線」。Transaction mode 是預設選擇：一個 request 用完就還，功能夠用，效能最好。
