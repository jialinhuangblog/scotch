---
title: "DB Table Partition"
slug: db-partition
brief: "一張大表在同一台機器裡切成多塊，按月份切最常見，刪舊資料直接 drop 一整塊。"
date: 2026-06-12
article: storage-deep
---

# DB Table Partition

> 一張表大到查詢變慢、刪舊資料也很費時，但還沒到要分散到多台機器，怎麼辦？

## 同一台機器，把表切成多塊

partition 是把一張邏輯上的大表，在**同一台 DB** 裡拆成多個實體小塊。對 application 來說還是一張表，DB 底下分開存。它跟 [sharding](chunk://sharding) 的差別是 partition 在同一台機器、sharding 跨機器。所有 sharding 都是 partition，但 partition 不一定跨機器。

最常見是 **horizontal partition（按 row 切）**：按 `created_at` 每月一塊、或按 `id` 範圍分塊，每塊是一個子表。這是 DB 的原生功能（`PARTITION BY RANGE`），app 還是看到一張表，DB 自動把 row 路由到對的塊。像一個大檔案櫃按月份分抽屜：找三月的只拉開三月那一層，不用翻整櫃。

## Vertical partition 其實是拆表

**vertical partition（按 column 切）** 是另一回事：把很少用又很大的欄位（一篇文章的 body、user 的 avatar）跟常用的小欄位分開存，讀取時就不用載入用不到的欄位。

但在 Postgres/MySQL 這不是原生功能。沒有 `PARTITION BY COLUMN` 這種語法，所謂 vertical partition 就是自己 `CREATE TABLE users_basic`、`users_extended`，查的時候自己 JOIN，DB 不知道它們本來是一張表。

推到極致的話，**每個 column 都分開存**，就是欄式儲存（columnar），也就是 ClickHouse、Parquet、BigQuery 這些 OLAP 系統的底層。查 100 個欄位裡的 3 個就只讀那 3 個，同型別的值放一起還能高度壓縮。

## 為什麼切

**查詢只碰相關的塊（partition pruning）**：`WHERE created_at >= '2026-05'` 只掃描五月那塊，DB 自動跳過其他塊。

**刪舊資料變便宜**：要清掉一年前的資料，`DROP PARTITION` 直接抽掉整塊，不用一筆筆 `DELETE`（後者還會留下一堆要 vacuum 的死 row）。

## 代價

partition key 一旦選定就難改。而且沒帶到 partition key 的查詢要掃描所有塊，不會比不分快。partition 只在「查詢通常只碰一小段範圍」時才划算。
