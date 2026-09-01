---
title: "UPDATE a row, what happens under the hood?"
slug: storage-internal
date: 2026-03-16
subtitle: "同一筆寫入，InnoDB 和 Cassandra 走完全不同的路。"
chapter: "storage"
tags: [innodb, b-tree, wal, mvcc, lsm-tree, cassandra, storage-engine]
related: [storage-deep, replication-cap, compaction-merge]
---

# UPDATE a row, what happens under the hood?

`UPDATE users SET name='Carol' WHERE id=1`

這筆操作在 InnoDB（B+ Tree engine）和 Cassandra（[LSM Tree](chunk://lsm-tree) engine）裡走的路完全不同。從 Client 送出 query 到資料安全落地，每一步都不一樣。

---

## RDB 路線：InnoDB（MySQL）

### Step 1：找到 page

InnoDB 的資料存在 [B+ Tree](chunk://b-tree) 的 leaf page 裡。每個 page 16KB，裡面塞了幾十到幾百筆 row。

```text
B+ Tree:
         [50, 100]          ← internal page（只有 key）
        /     |     \
[1..49 rows] [50..99 rows] [100..150 rows]  ← leaf page（key + data）
```

`WHERE id=1` 從 root 開始，走 3-4 層到 leaf page。

### Step 2：Buffer Pool

InnoDB 不會每次都從磁碟讀 page。記憶體裡有一塊 **Buffer Pool**（預設 128MB，生產環境通常設幾 GB），是 page 的 cache。

```text
查 id=1 的 page 在不在 Buffer Pool？
  → 在：直接用（命中）
  → 不在：從磁碟讀進 Buffer Pool（miss）
```

大部分 OLTP 場景，hot data 的 page 幾乎都在 Buffer Pool 裡，命中率 > 99%。

### Step 3：在記憶體裡改 page

找到 id=1 的 row，在 Buffer Pool 裡把 name 從 'Bob' 改成 'Carol'。

這時 page 被改了但還沒寫回磁碟，叫 **dirty page**。

### Step 4：寫 WAL（redo log）

改完 page 之後，把「page X, offset Y, 改成 Carol」這筆記錄寫進 [WAL](chunk://wal)。

```text
WAL record:
  LSN: 10042               ← Log Sequence Number，全局遞增
  Page: 5
  Offset: 320
  Before: "Bob"
  After: "Carol"
```

WAL 是 append-only，sequential write，速度很快。寫完 WAL 並 fsync 到磁碟後，回覆 Client「OK, committed」。

此時 dirty page 還在 Buffer Pool 裡，還沒寫回磁碟的 B+ Tree。沒關係，WAL 已經在磁碟上了，斷電也能從 WAL 恢復。

### Step 5：[MVCC](chunk://mvcc) — 舊版本去哪

UPDATE 不是直接覆蓋。InnoDB 在改之前，先把舊值 ('Bob') 複製到 undo log。

```text
B+ Tree leaf page:
  id=1, name="Carol"（最新版本）
          ↓ 指標
undo log:
  name="Bob"（舊版本）
```

如果這時有另一個 transaction 還在讀 id=1（它開始得比這次 UPDATE 早），它會沿著指標去 undo log 找到 'Bob'。讀到的是自己 transaction 開始時的 snapshot。

### Step 6：Checkpoint — dirty page 寫回磁碟

背景的 checkpoint process 定期把 dirty page 從 Buffer Pool 寫回磁碟的 B+ Tree。寫完後，對應的 WAL record 就可以丟了。

```text
完整流程：

Client: UPDATE users SET name='Carol' WHERE id=1
  │
  ▼
Buffer Pool: 找到 page → 改 page（dirty）→ 舊值搬到 undo log
  │
  ▼
WAL: 寫入 redo record → fsync → 回覆 Client OK
  │
  ▼
背景 Checkpoint: dirty page 寫回 B+ Tree → WAL 截斷
```

### pseudocode

```javascript
function update(id, new_name):
    // Step 1-2: 找到 page
    page = buffer_pool.get(id)
    if page == null:
        page = disk.read(btree.find_leaf(id))
        buffer_pool.put(page)

    row = page.find_row(id)

    // Step 5: MVCC — 舊值搬到 undo log
    undo_log.append(row.clone())
    row.roll_pointer = undo_log.last()

    // Step 3: 改 page
    row.name = new_name
    row.trx_id = current_transaction.id
    page.mark_dirty()

    // Step 4: 寫 WAL
    wal.append({page: page.id, offset: row.offset, after: new_name})
    wal.fsync()

    return OK
```

---

## NoSQL 路線：Cassandra（LSM Tree）

同一筆操作：`UPDATE users SET name='Carol' WHERE id=1`

### Step 1：寫 WAL（Commit Log）

跟 InnoDB 一樣，先寫 log 保證 crash safety。Cassandra 叫 commit log。

### Step 2：寫進 Memtable

Memtable 是記憶體裡的 sorted 結構。直接把 `{id: 1, name: "Carol", timestamp: T3}` 插進去。

```text
Memtable（記憶體，按 key 排序）:
  id=1: name="Carol", ts=T3    ← 剛寫的
  id=5: name="Eve",   ts=T1
  id=9: name="Ivan",  ts=T2
```

不需要找 page、不需要找位置。直接插入記憶體結構，O(log N) 的記憶體操作。寫完就回覆 Client OK。

沒有 Buffer Pool，沒有 dirty page，沒有 B+ Tree。

### Step 3：沒有 MVCC

Cassandra 不需要 MVCC。沒有 transaction、沒有 isolation level。每筆寫入都帶 timestamp，讀的時候取 timestamp 最大的那個就是最新值。

```text
id=1 的歷史：
  ts=T1: name="Alice"
  ts=T2: name="Bob"
  ts=T3: name="Carol"    ← 最新
```

如果兩個 client 同時寫 id=1，用 **last-write-wins**：timestamp 大的覆蓋小的。不需要 lock，不需要版本鏈。

### Step 4：Flush 成 SSTable

Memtable 滿了（預設幾 MB），整包排好序寫到磁碟，變成一個 SSTable 檔案。Sequential write，不需要找位置。

```text
Memtable 滿了 → flush
  ↓
SSTable-001.db（磁碟，immutable）:
  id=1: name="Carol", ts=T3
  id=5: name="Eve",   ts=T1
  id=9: name="Ivan",  ts=T2
```

SSTable 寫完就不再修改。舊的寫入可能在更早的 SSTable 裡，之後 compaction 會合併。

### Step 5：Compaction

SSTable 越來越多。Compaction 把多個 SSTable 合併，丟掉同一個 key 的舊版本。

```text
SSTable-001: id=1 name="Alice" ts=T1
SSTable-002: id=1 name="Carol" ts=T3
  ↓ compaction
SSTable-003: id=1 name="Carol" ts=T3    ← 只保留最新
```

### pseudocode

```javascript
function update(id, new_name):
    timestamp = now()

    // Step 1: 寫 commit log
    commit_log.append({id: id, name: new_name, ts: timestamp})
    commit_log.fsync()

    // Step 2: 寫 memtable
    memtable.put(id, {name: new_name, ts: timestamp})

    // Step 3: 不需要 MVCC、不需要 undo log、不需要找 page

    return OK

// 背景：memtable 滿了 → flush
function flush():
    sorted_data = memtable.to_sorted_array()
    sstable = disk.write_sequential(sorted_data)
    commit_log.truncate()
    memtable.clear()
```

---

## 兩條路線，一張表

| 步驟 | InnoDB（B+ Tree） | Cassandra（LSM Tree） |
|---|---|---|
| 找資料位置 | 走 B+ Tree 找 leaf page | 不需要找，直接插記憶體 |
| 改資料 | 在 Buffer Pool 裡改 page | 寫進 Memtable |
| 舊值處理 | 搬到 undo log（MVCC） | 不處理，用 timestamp 比大小 |
| 寫 log | WAL（redo log） | Commit Log |
| 回覆 Client | WAL fsync 後 | Commit Log fsync 後 |
| 資料落地 | 背景 checkpoint 寫回 B+ Tree page | 背景 flush 成 SSTable |
| 寫入模式 | Random write（找到 page 再改） | Sequential write（整包排好序寫） |
| 衝突處理 | Transaction + MVCC | Last-write-wins（timestamp） |

---

## 為什麼兩條路都先寫 log

InnoDB 和 Cassandra 做法差這麼多，但第一步都是寫 log，因為資料先存在記憶體（Buffer Pool 或 Memtable），記憶體斷電就沒了。Log 是磁碟上的保險，斷電後從 log 恢復。

差別在 log 之後的路：

```text
InnoDB:     WAL → 背景把 dirty page 寫回 B+ Tree（random write）
Cassandra:  Commit Log → 背景把 memtable flush 成 SSTable（sequential write）
```

兩條路的終點不同：一個維護一棵排好序的 B+ Tree，一個不斷產生新的 SSTable 再定期合併。讀取效能和寫入效能的取捨，就在這裡。

## Random write 沒有消失

InnoDB 的 checkpoint 最終還是 random write（把 dirty page 寫回 B+ Tree 的各個位置）。WAL 的作用是把 random write 搬離 client 的等待路徑，丟到背景慢慢做。

```text
沒有 WAL 的 B+ Tree：
  Client 寫入 → 馬上 random write → 回覆 Client
  （Client 等 random write，慢）

InnoDB + WAL：
  Client 寫入 → WAL sequential write → 回覆 Client OK
                    ↓（背景，Client 不用等）
                 checkpoint random write
  （Client 只等 sequential write，快）

LSM Tree：
  Client 寫入 → Commit Log sequential write → 回覆 Client OK
                    ↓（背景）
                 flush sequential write → compaction sequential write
  （從頭到尾都是 sequential write）
```

InnoDB 用 WAL 把 random write 延後到背景。LSM Tree 更激進，連背景都不做 random write。代價是讀取要掃多個 SSTable，而且 compaction 會佔磁碟空間和 IO。

天下沒有白來的效能，寫得快，就一定在讀或別處還回去。

嚴格講，這是儲存引擎的 RUM 取捨：讀（Read）、寫（Update）、空間（Memory）三個負擔，最多壓低兩個，剩下那個被迫變差。B-tree 讀快，代價落在寫放大；LSM 寫快、配上壓縮空間通常也省，主要代價落在讀（要掃多個 SSTable）。各自犧牲一個。它跟 CAP 像（不能全拿），但更軟：RUM 是連續、可調的取捨，同一個 LSM 換個 compaction 策略就能在讀/寫/空間之間滑，不是 CAP 那種硬性二選一。真要三個都壓低也行，代價就跑到別處：多投入 RAM 跟硬體（用錢換），或換更聰明的演算法把整條曲線往前推。
