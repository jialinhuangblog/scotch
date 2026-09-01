---
title: "Clustered Index"
slug: clustered-index
brief: "資料的物理儲存順序由誰決定。InnoDB 綁 PK，PostgreSQL 不綁，SQL Server 可以選。"
date: 2026-03-15
updated: 2026-07-20
revisions: 4
article: storage-deep
---

# Clustered Index

先讀 [index-basics](chunk://index-basics) 了解 index 和 B+ Tree 的基礎，再來看這篇。

磁碟讀取的瓶頸在 seek，找到位置的時間遠比讀資料本身慢。如果相關的資料散落在磁碟各處，每筆都要 seek 一次。如果相關的資料排在一起，一次 seek 讀一整個 page，幾百筆一起拿到。

Clustered index 就是讓資料按某個 key 的順序排列存在磁碟上。範圍查詢（`WHERE id BETWEEN 100 AND 200`）變成連續讀取，不需要跳來跳去。

## 三個要素

Clustered index 的定義，三件事都要滿足：

1. **物理排序**：資料在磁碟上的實際排列順序由某個 key 決定
2. **資料住在 leaf 裡**：B+ Tree 的 leaf page 直接裝整筆 row，查到 leaf 就拿到資料
3. **一張表最多一個**：資料只能按一種順序實體排列

第三點是關鍵限制。選 clustered index 等於決定哪個查詢模式最重要，按 `id` 排就無法同時按 `created_at` 排。

Clustered index 定義了整張表的物理結構。InnoDB 裡每張表都存在一個 clustered index：沒宣告 PK 時，InnoDB 會建一個隱藏的 row ID 當 clustered index。資料總得存在某個 B+ Tree 裡。

## Page：磁碟 IO 的最小單位

DB 不會一次讀一筆 row，而是一次讀一個 page（通常 16KB）。一個 page 裡塞幾十到幾百筆 row。磁碟的瓶頸在 seek（找位置），找到之後連續讀 16KB 幾乎不花時間。所以以 page 為單位讀寫比逐筆讀寫快得多。

B+ Tree 的每個 node 就是一個 page。整個 DB 的 IO 都建立在 page 上。

注意：這裡的 page 跟 API pagination（分頁）完全無關。

## 各家 DB 的做法

### InnoDB（MySQL）

PK 強制是 clustered index，沒得選。資料直接存在 PK B+ Tree 的 leaf page 裡，按 PK 排序。

```text
PK B+ Tree leaf page:
| id=1, name="Alice", email="a@x.com" |
| id=2, name="Bob",   email="b@x.com" |
| id=3, name="Carol", email="c@x.com" |
```

查 `WHERE id = 2` 走 B+ Tree 到 leaf，資料就在那裡，一次 IO。

所有 secondary index（例如 email 上的 index）的 leaf 存的是 PK 值。查 secondary index 後還要拿 PK 回 clustered index 再查一次，這叫 bookmark lookup。

PK 用自動遞增 ID 的話，新資料永遠 append 到最後一個 leaf page，效能最好。PK 用 UUID 的話，每次 INSERT 可能插進 B+ Tree 中間，觸發 page split（把一個滿的 page 拆成兩個），寫入效能下降。

### PostgreSQL

沒有 clustered index，也無法手動建立。這不是功能限制，是架構設計：PostgreSQL 的資料存在 heap，index 是另外的結構，兩者永遠分開。Clustered index 的前提是「資料住在 index 的 leaf 裡」，heap model 天生不支援這件事。

根本原因是 [MVCC](chunk://mvcc) 的實作方式。PostgreSQL 的 UPDATE 會寫新版本到 heap 任意有空間的位置，舊版本留在原地等 VACUUM。如果資料要按 PK 物理排序，新版本就不能隨便塞，會跟 MVCC 的 append-anywhere 模型衝突。InnoDB 可以有 clustered index，是因為它的 MVCC 把舊版本搬到 undo log，leaf page 永遠只有最新資料，不跟 B+ Tree 的物理順序打架。

Heap 不是資料結構課本的 heap（priority queue），是「一堆沒有順序的 page」。新資料找一個有空間的 page 塞進去，不保證任何順序。

```text
Heap（沒有順序）:
位置 0: { id=3, name="Carol" }
位置 1: { id=1, name="Alice" }
位置 2: { id=2, name="Bob"   }

PK Index（另外建的 B+ Tree）:
| id=1 → 位置 1 | id=2 → 位置 2 | id=3 → 位置 0 |
```

所有 index（包括 PK）都是 secondary。查任何 index 都要回 heap 拿資料，永遠兩步。

PostgreSQL 有 `CLUSTER` 指令可以按某個 index 重新排列 heap，但只是一次性的物理重排，之後新資料不會維持順序。

### SQL Server

PK 預設是 clustered index，但可以指定其他欄位。例如把 `created_at` 設為 clustered index，資料就按時間排序。適合時序資料的查詢模式。

## 綁在一起的設計決策

Clustered index、UPDATE 行為、舊版本存放位置、清理方式，這四件事是一組綁在一起的決策。選了第一項，後面跟著決定。

| 設計決策 | InnoDB | PostgreSQL |
|---|---|---|
| 資料儲存方式 | Clustered index（leaf 裝資料）| Heap（無序）|
| UPDATE 行為 | 原地改 | 寫新版本，舊的留原地 |
| 舊版本放哪 | Undo log（另一個地方）| 原 heap page 裡 |
| 清理方式 | Undo log purge | VACUUM |

兩家 DB 從不同端切入這組決策：

**InnoDB 從「快速 PK 查詢」往下推**：要 clustered index → UPDATE 得原地改（不然 B+ Tree 就維持不了順序）→ 舊版本需要另一個地方 → 發明 undo log 來存。這條鏈上 clustered index 是起點，undo log 是被迫出現的配套。

**PostgreSQL 從 no-overwrite 哲學往下推**：UPDATE 永遠寫新版本 → 新版本塞到 heap 任意位置 → heap 沒有物理順序 → clustered index 接不上。這條鏈上 heap 是起點，clustered index 做不到是結果。

所以「clustered index 先還是 undo log 先」這個問題沒有普世答案。問 InnoDB 團隊，clustered index 先；問 PostgreSQL 團隊，他們從一開始就沒在考慮 clustered index 這件事，整組設計圍繞 no-overwrite 展開。


## PK 怎麼選

這組好處拿不拿得到，跟 PK 選 UUID 還是 incremental 直接相關，拆在 [PK 選型](chunk://primary-key-choice)。

## 取捨

| | Clustered（InnoDB） | Heap（PostgreSQL） |
|---|---|---|
| PK 查詢 | 快，一次到位 | 多一步，要回 heap |
| 寫入 | 要維持 B+ Tree 順序 | 直接 append，快 |
| UPDATE | 原地改（page 放得下的話） | 寫新版本，舊版本標記死亡等 VACUUM |
| 空間 | 資料只存一份 | 舊版本留在 heap，等 VACUUM 清 |

讀多寫少的場景，clustered index 有優勢。寫多讀少的場景，heap 的 append 更快。實務上這個差異很少是選 DB 的決定因素。
