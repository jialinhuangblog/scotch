---
title: "查詢從 2ms 變成 1.2 秒只因為資料變多，後面 index、partition、sharding 都是為了讓每次查詢更容易找到資料"
slug: storage-deep
date: 2026-03-14
updated: 2026-07-12
revisions: 4
chapter: "storage"
tags: [database, index, b-tree, partition, sharding, innodb, storage]
related: [the-log, replication-cap, storage-internal, scaling-first-move]
---

# 查詢從 2ms 變成 1.2 秒只因為資料變多，後面 index、partition、sharding 都是為了讓每次查詢更容易找到資料

產品上線三個月。使用者從 100 人變成 10 萬人。有一張 orders 表，三個月前查詢要 2ms，現在要 1.2 秒。沒改過 code，沒改過 schema。只是資料從 1 萬筆變成 800 萬筆。

DBA 說「加個 [index](chunk://index-basics) 就好了」。但什麼是 index？加在哪裡？為什麼有時候加了反而更慢？

這篇從一張表開始，走完 index → engine → [ACID](chunk://acid) → [partition](chunk://db-partition) → [sharding](chunk://sharding) 的完整路徑。每一步都是因為上一步撐不住了，才一個一個加上去的。

---

## 沒有 index 的世界

一張 users 表，100 萬筆。執行 `SELECT * FROM users WHERE email = 'bob@example.com'`。

DB 不知道 bob 在哪裡。只能從第一筆開始，一筆一筆比對 email 欄位。這叫 full table scan。100 萬筆就比對 100 萬次。

資料存在磁碟上，每次讀取是以 page 為單位（通常 16KB）。一個 page 放幾十到幾百筆 row。Full table scan 要把整張表的所有 page 都讀一遍。

問題很清楚：查詢時間跟資料量成正比。資料翻倍，查詢時間翻倍。O(n)。

---

## B-Tree：用目錄找資料

[B-Tree](chunk://b-tree) 是大部分 RDBMS 的預設 index 結構。PostgreSQL、MySQL（InnoDB）都用這個。

想像一本字典。查「banana」不會從第一頁翻到最後一頁。先看目錄：B 開頭在第 50 頁。翻到第 50 頁附近，再細找。三步就到。

B-Tree 的結構類似：

```text
                         [M]
                        /   \
                 [D, H]       [R, W]
                / |  \        / |  \
           [A-C][D-G][H-L] [M-Q][R-V][W-Z]
```

每一層是一個 node，對應磁碟上的一個 page。從 root 往下走，每層砍掉大部分不可能的範圍。100 萬筆只要 3-4 層就能定位。O(log n)。

### Leaf node 存什麼

這是最關鍵的部分，取決於 index 類型。

**[Clustered index](chunk://clustered-index)（InnoDB 的 Primary Key）：** leaf node 直接存整筆 row 的資料。

```text
leaf page: | PK=1, name="Alice", email="a@x.com" |
           | PK=2, name="Bob",   email="b@x.com" |
           | PK=3, name="Carol", email="c@x.com" |
```

`WHERE id = 2` 走 B-Tree 到 leaf，資料就在那裡。一次查詢。

Clustered index 不是 MySQL 獨有，但各家行為不同。InnoDB 的 PK 強制是 clustered index，沒得選。SQL Server 的 PK 預設是 clustered 但可以改成其他欄位。PostgreSQL 沒有 clustered index，資料存在 heap 裡，所有 index（包括 PK）都是 secondary，查完 index 都要回 heap 拿資料。

**Secondary index（例如在 email 上建的 index）：** leaf node 存的是 PK 值。

```text
leaf page: | email="a@x.com" → PK=1 |
           | email="b@x.com" → PK=2 |
```

`WHERE email = 'b@x.com'` 先走 email index 找到 PK=2，再拿 PK=2 去 clustered index 查一次拿到整筆資料。兩次 B-Tree lookup。這叫 bookmark lookup。PostgreSQL 的話，所有查詢都要回 heap，等於每次都是 bookmark lookup。

### Leaf 之間有鏈結

B-Tree 的 leaf node 之間用指標串成鏈結。這讓範圍查詢變得可行：

```sql
WHERE age > 25 AND age < 30
```

走到 age=25 的 leaf，然後沿著鏈結往右掃到 age=30 停。不用回到 root 重查。

### 其他 index 結構

B-Tree 不是唯一的選擇。不同的查詢模式需要不同的資料結構：

**Hash index** 把 key 丟進 hash function，直接算出位置。O(1)，比 B-Tree 更快。但 hash 值沒有順序，所以範圍查詢做不到（`WHERE age > 25` 沒辦法用 hash）。只適合精確匹配。

**Bitmap index** 為每個可能的值建一個 bit array。假設 status 欄位有三種值，100 萬筆資料：

```text
status="pending":    1 0 0 1 0 1 0 0 ...  (100 萬個 bit)
status="shipped":    0 1 0 0 1 0 0 1 ...
status="delivered":  0 0 1 0 0 0 1 0 ...
```

`WHERE status = 'pending'` 直接讀那個 bit array，不用掃任何 row。多條件組合用 bitwise 運算：`WHERE status = 'pending' AND region = 'asia'` 就是兩個 bitmap 做 AND。適合值很少的欄位（enum 型別）。值太多的話每個值都要一整條 bitmap，記憶體吃不消。

**Full-text index** 用[倒排索引](chunk://search-inverted-index)（inverted index）。把文章內容拆成單詞，記錄每個詞出現在哪些 row：

```text
"apple"  → row 1, 3, 7
"banana" → row 2, 3, 9
```

`MATCH(content) AGAINST('apple banana')` 查兩個詞的 row 清單，取聯集或交集。不用打開每篇文章比對。`LIKE '%apple%'` 要逐筆掃描，倒排索引直接查表。Elasticsearch 的核心就是這個結構，只是加了分詞器、相關性評分、分散式查詢這些層。

### Index 的代價

每多一個 index，每次 INSERT 和 UPDATE 都要多寫一份 index 結構。五個 index 就是六次寫入（一次 data + 五次 index）。index 換來的是讀快，代價是寫變慢。

所以 index 不是越多越好。加在常查詢的欄位上。不常查的欄位加了 index 只會拖慢寫入。

---

## Storage Engine：為什麼 InnoDB 贏了

這一段是 MySQL 特有的歷史。MySQL 的 storage engine 是可插拔的，同一台 MySQL，不同 table 可以用不同 engine。這個彈性帶來了一個早期的選擇題：

| | InnoDB | MyISAM |
|---|---|---|
| Locking | Row level | Table level |
| Transaction | ACID | 沒有 |
| Crash recovery | 自動（WAL） | 手動修復 |
| Index | Clustered（data 存在 leaf） | 非 clustered（data 另外存） |

MyISAM 寫入時鎖整張表。一個人在寫，所有讀和寫都等。100 個 request 同時來，變成排隊。

InnoDB 鎖到 row level。100 個人同時寫不同 row，互不干擾。

MyISAM 沒有 crash recovery。server 掛了，表可能損壞，要跑 `myisamchk` 手動修。InnoDB 用 [WAL](chunk://wal)（write-ahead log），掛了之後重啟自動從 redo log 恢復。

看到這裡會有一個疑問：MyISAM 輸這麼徹底，為什麼存在過，還當了十五年預設？

答案在 1995 年的市場。MySQL 的目標用戶是 PHP 網站、留言板、CMS：讀多寫少，掛了重跑就好，要快要簡單。這群用戶不需要 transaction。MyISAM 不是做不出 transaction，是刻意省掉，換更快的讀和更簡單的部署。transaction 這塊 MySQL 用插拔介面留給別人做：InnoDB 就是芬蘭公司 Innobase 做的第三方 engine，2001 年才併進 MySQL 3.23。後來 web 應用開始收錢，電商、金流出現，「掛了重跑就好」不再成立。MySQL 5.5（2010）把 InnoDB 轉正成預設，現在幾乎沒有理由再用 MyISAM。

Oracle 和 SQL Server 從第一天就走另一條路。他們賣的是銀行、ERP、訂單系統，客戶的底線是錢不能算錯、機器掛了資料不能壞。所以 transaction、row lock、crash recovery 不是功能清單上的一項，是整個 DB 圍繞它設計的核心。engine 跟 DB 是同一塊，拆不開，也不需要拆。PostgreSQL 是學術血統，transaction 同樣內建在核心。

把 InnoDB 贏的理由拆開，是四個特性：MVCC、ACID、row lock、crash recovery。這四個是商用 OLTP 的入場券，其他家的客戶第一天就在買，所以沒有「選 engine」這件事。MySQL 從不需要入場券的市場長出來，事後才靠 InnoDB 補票：

| DB | 內建 engine | 等於 InnoDB 的哪些特性 |
|---|---|---|
| MySQL（InnoDB） | clustered B+Tree + redo/undo log | 基準：MVCC、ACID、row lock、crash recovery |
| PostgreSQL | heap + WAL | MVCC、ACID、row lock、crash recovery |
| SQLite | B-Tree（預設 rollback journal，WAL 要手動開） | ACID、crash recovery。鎖是整個 DB 一把，沒有 row lock |
| Oracle | heap + redo/undo log | MVCC（靠 undo 留舊版本）、ACID、row lock、crash recovery |
| SQL Server | heap 或 clustered index + transaction log | ACID、row lock、crash recovery。MVCC 要手動開 snapshot isolation，舊版本存在 tempdb |

嚴格說 PostgreSQL 12 之後有 table access method 介面可以換 engine（預設 heap），SQL Server 也有 In-Memory OLTP 這顆獨立 engine。但實務上幾乎沒人換，所以說「綁死」不算冤枉。

補完票之後 InnoDB 還反超了幾處：clustered index 讓 PK 查詢少一跳，PostgreSQL 沒這個選項；舊版本集中放在 undo log，用完就清，不像 PostgreSQL 把死掉的版本留在 heap 原地、等 vacuum 事後回收。功能面追平，形態上各有輸贏。

---

## ACID：選了 InnoDB，換到的是什麼

「支援 transaction」這句話本身不保證什麼。能寫 BEGIN + COMMIT 是一回事，出事時資料不壞是另一回事。選 InnoDB 而不是 MyISAM，換到的就是 [ACID](chunk://acid) 四個保證：

- **Atomicity（原子性）**：一個 transaction 全做或全不做。扣了錢但訂單沒建，不會發生。
- **Consistency（一致性）**：資料永遠符合定義好的規則，foreign key、unique constraint 由 DB 把關。
- **Isolation（隔離性）**：兩個 transaction 同時跑，互相看不到對方寫到一半的資料。InnoDB 靠 [MVCC](chunk://mvcc) 做到讀寫互不等待，隔離鬆緊由 [isolation levels](chunk://isolation-levels) 決定。
- **Durability（持久性）**：commit 之後就算斷電也不會丟，InnoDB 靠 [WAL](chunk://wal)（先寫 log 再寫資料）保證。

這四個字母底下實際怎麼跑（undo log、version chain、redo log 重放、WAL 跟 MVCC 怎麼分工），是另一篇的主題：[UPDATE a row, what happens under the hood?](article://storage-internal)。在這條擴展路上你只要記得：到了這個量，重點已經不是能不能寫入，是出事的時候資料會不會壞。

---

## Partition：一張表太大，在同一台 DB 裡切開

Index 解決了「查得慢」。但當一張表有 5 億筆 row，即使有 index，B-Tree 的層數變多，cache 放不下，每次查詢都要碰磁碟。

Partition 把一張表切成多塊，邏輯上還是同一張表，DB 內部自動管理。

### Horizontal partition（按 row 切）

```sql
CREATE TABLE sales (
    id SERIAL,
    sale_date DATE NOT NULL,
    amount DECIMAL(10,2)
) PARTITION BY RANGE (sale_date);

CREATE TABLE sales_2023 PARTITION OF sales
    FOR VALUES FROM ('2023-01-01') TO ('2024-01-01');

CREATE TABLE sales_2024 PARTITION OF sales
    FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
```

`WHERE sale_date = '2024-02-15'` 時，DB 知道只掃 sales_2024，不碰 sales_2023。這叫 partition pruning。5 億筆切成 5 份，每份 1 億，掃描量直接降 80%。

INSERT 時 DB 自動路由到正確的 partition，application 不用改 code。

（按 column 切的 vertical partition 在 Postgres/MySQL 其實就是自己拆成多張表再 JOIN，不是原生功能，跟這裡的 row 切是兩回事，細節見 [db-partition](chunk://db-partition)。）

### Partition 的限制

Partition 在同一台 DB 裡。磁碟空間、CPU、記憶體都是那一台的上限。5 億筆切成 5 個 partition，每個 partition 還是 1 億筆。如果一台機器連 1 億筆都撐不住呢？

---

## Sharding：切到不同機器

Partition 是 DB 幫忙管的，application 不用知道。Sharding 是 application 自己決定資料去哪台機器。

```text
userId % 3 = 0 → Shard A（機器 1）
userId % 3 = 1 → Shard B（機器 2）
userId % 3 = 2 → Shard C（機器 3）
```

每台機器只存三分之一的資料。三台機器的 CPU、記憶體、磁碟各自獨立。寫入量也分散了。

### Routing logic 長什麼樣

Sharding 最直接的代價是 application 要自己決定每筆 query 去哪台 DB。這個 routing logic 會滲透到整個 codebase：

```typescript
const shardConfigs = [
  { id: 0, host: 'db-shard-0.internal', port: 5432 },
  { id: 1, host: 'db-shard-1.internal', port: 5432 },
  { id: 2, host: 'db-shard-2.internal', port: 5432 },
];

function getShardForUser(userId: number) {
  return shardConfigs[userId % shardConfigs.length];
}

// 每個 query 都要先算 shard
async function getUser(userId: number) {
  const shard = getShardForUser(userId);
  const db = await connectTo(shard);
  return db.query('SELECT * FROM users WHERE id = $1', [userId]);
}

// 跨 shard 查詢要自己合併
async function getUsers(userIds: number[]) {
  const grouped = new Map<number, number[]>();
  for (const id of userIds) {
    const shardId = id % shardConfigs.length;
    if (!grouped.has(shardId)) grouped.set(shardId, []);
    grouped.get(shardId)!.push(id);
  }

  const results = await Promise.all(
    [...grouped.entries()].map(([shardId, ids]) => {
      const db = connectTo(shardConfigs[shardId]);
      return db.query('SELECT * FROM users WHERE id = ANY($1)', [ids]);
    })
  );

  return results.flat();
}
```

沒有 sharding 的時候，`getUser` 就是一行 SQL。有了 sharding，每個 query 都要先算 shard，跨 shard 的要自己拆、自己合併。這個複雜度會擴散到 codebase 的每個 data access layer。

### 其他代價

**跨 shard JOIN。** `SELECT * FROM orders JOIN users ON orders.user_id = users.id`，如果 orders 和 users 用不同的 shard key，JOIN 要跨所有 shard，在 application layer 合併。

**跨 shard transaction。** 扣 user A 的錢（Shard 0）加到 user B 的帳戶（Shard 1）。一個 transaction 跨兩台機器，需要分散式 transaction（2PC），複雜度暴增。

**Resharding。** 三台不夠了要加第四台。`userId % 3` 變成 `userId % 4`，大量資料要搬家。遷移期間服務不能停。Consistent hashing 可以減少搬移量，但不能消除。

### 順序

這些手段有明確的先後順序：

```text
查詢慢了
  ↓ 加 index（最小代價，改 schema 就好）
還是慢
  ↓ 做 partition（同一台 DB 裡切，application 不用改）
一台 DB 撐不住了
  ↓ 做 sharding（最大代價，application 要改路由邏輯）
```

每一步的代價都比上一步大一個量級。Index 是加一行 DDL。Partition 要規劃切分策略。Sharding 要改 application 架構、處理跨 shard 查詢、規劃 resharding 流程。

所以 sharding 是最後手段。能用 index 解決就不 partition，能 partition 就不 sharding。

---

## 回到那張 orders 表

三個月前 1 萬筆，現在 800 萬筆，查詢從 2ms 變成 1.2 秒。以下是一條示意的時間軸：數字都是舉例，真正該盯的是每一步的觸發訊號，不是筆數。

第一步的訊號是「查詢慢到超過你的 latency 目標」。在 `user_id` 和 `created_at` 上加 composite index，掃描變成索引查找，查詢回到個位數 ms。變的不是筆數，是有沒有走對 index。

六個月後資料來到幾千萬筆。但讓你想動 partition 的通常不是這個數字，而是**單表開始難維護**：加欄位要鎖很久、重建 index 跑好幾小時、vacuum / analyze 時間拉長，hot 跟 cold 的資料混在一起讓 cache 命中變差。這時按 `created_at` 做 range partition、每月一個，大部分查詢只碰最近幾個月，舊資料順手歸檔。觸發點是「維護變麻煩」，不是「到幾筆」。

兩年後資料上看數十億筆。但真正需要 sharding 的不是 row 數（一台 DB 裝幾十億筆很常見），而是**單台的寫入吞吐或 IO 到頂**：每秒寫入接近磁碟頻寬、CPU 長時間吃滿、連線數到上限。按 `user_id` hash sharding 分到多台，每台只處理一部分 workload。代價是 application 要加 shard router，跨 shard 的報表查詢改成非同步 batch job。

每一步的觸發點都是一個症狀：latency 超標、維護變麻煩、單機寫入到頂。能拖多久看業務成長速度，但方向是確定的：資料只會越來越多。

---

## 這篇沒講到的

**[LSM-Tree](chunk://lsm-tree)** 是 B-Tree 的對手。B-Tree 讀快寫慢，LSM-Tree 寫快讀慢。Cassandra、RocksDB、LevelDB 都用 LSM-Tree。適合寫入量遠大於讀取量的場景。

**[Replication](chunk://replication)** 解決的是另一個問題：一台機器掛了資料怎麼辦。Sharding 分散負載，Replication 提供冗餘。兩者通常一起用。

**[CAP theorem](chunk://cap)** 限制了分散式 DB 的設計空間。Sharding 之後 DB 變成分散式系統，consistency 和 availability 的取捨無法迴避。
