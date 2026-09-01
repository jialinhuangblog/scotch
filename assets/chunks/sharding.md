---
title: "Sharding"
slug: sharding
brief: "資料切到多台機器，hash 跟 range 兩種切法各有各的問題。"
date: 2026-03-15
updated: 2026-03-27
revisions: 1
article: storage-deep
---

# Sharding

> 通用概念。MongoDB 內建 sharding，MySQL/PostgreSQL 需要靠 proxy（Vitess、Citus）或 application 層自己做。

一台 DB 撐不住，就把資料分散到多台。每台只存一部分資料，叫一個 shard。

## Partition vs Sharding

兩個常被混用，但有差別：

```text
Vertical partition：  按欄位切（column A-C 一邊，column D-F 另一邊）
Horizontal partition：按 row 切（key 0-999 一組，key 1000-1999 一組）
Sharding：           horizontal partition 分散到不同機器上
```

```text
Horizontal partition（同一台機器）：
  DB Server A
    ├── partition_0 (key 0-999)
    └── partition_1 (key 1000-1999)

Sharding（跨機器）：
  DB Server A → shard_0 (key 0-999)
  DB Server B → shard_1 (key 1000-1999)
```

所有 sharding 都是 horizontal partition，但不是所有 partition 都是 sharding。同一台機器上的 partition 解決的是查詢效能和資料管理（例如按月份 partition，刪舊資料直接 drop partition）。Sharding 解決的是單機撐不住（CPU、磁碟、QPS 超過一台的上限）。

## 兩種分法

### Hash Sharding

`shard = hash(key) % N`。資料均勻分散，不會有 hot spot。

問題：`WHERE created_at BETWEEN ...` 這種 range query 要掃所有 shard，因為 hash 打散了順序。

### Range Sharding

按 key 的範圍分。`id 1–1000` 在 shard 0，`1001–2000` 在 shard 1。Range query 只需要掃一個或少數幾個 shard。

問題：如果 key 分布不均（例如最新的 id 都落在最後一個 shard），容易產生 hot spot。

## Shard Key 的選擇

shard key 基本上決定了效能的天花板。選錯了，resharding 的代價巨大。

好的 shard key：高 cardinality（值很多種）、查詢常用到、分布均勻。

壞的 shard key：低 cardinality（例如 `country`，只有幾十個值）、查詢幾乎不用到。

## Resharding

業務成長，原本的 shard 不夠了，要加 shard。如果用 `hash % N`，N 變了，幾乎所有資料都要搬（rehash）。

Consistent hashing 減少搬遷量：只搬 1/N 的資料。但實務上 resharding 仍然是大工程，需要 double-write、驗證、切換。

## Cross-Shard Query

`JOIN` 兩張表，如果資料在不同 shard 上，DB 無法直接 JOIN。要嘛在 application 層組合，要嘛把相關資料放在同一個 shard（co-locate）。

MongoDB 的 `mongos` router 會把 cross-shard query 拆成多個子查詢，再合併結果。效能遠不如 single-shard query。

---

Sharding 解決單機容量瓶頸。用 hash 分布均勻、卻做不好 range query；用 range 保住順序、又容易有 hot spot。選 shard key 是一次性決定，改的成本極高。
