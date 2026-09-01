---
title: "DB Landscape"
slug: db-landscape
brief: "SQL、NoSQL、storage engine、managed 各是什麼、什麼時候用。"
date: 2026-03-15
updated: 2026-07-20
revisions: 2
---

# DB Landscape

資料庫選型的第一步：知道有哪些種類，每種的代表產品是誰。

## SQL（關聯式）

資料存在表格裡，用 SQL 查詢。有 schema、有 JOIN、有 transaction（ACID）。

| 產品 | 特色 | 常見場景 |
|---|---|---|
| MySQL（InnoDB） | 最普及的 RDBMS | Web 應用的預設選擇 |
| PostgreSQL | 功能最完整，擴充性強 | 需要進階功能（JSON、GIS、Full-text） |
| SQL Server | 微軟生態圈 | .NET 企業應用 |
| SQLite | 嵌入式，整個 DB 是一個檔案 | 手機 app、桌面應用、prototype |

## NoSQL

不用 SQL 或不強制 schema。不同種類解決不同問題。

### Document（存 JSON 文件）

schema 彈性高，每筆資料結構可以不同。適合需求變動快的應用。

| 產品 | 特色 |
|---|---|
| MongoDB | 最普及的 NoSQL，內建 sharding 和 replica set |
| CouchDB | 支援 multi-leader replication，離線優先設計 |

### Key-Value（查 key 拿 value）

結構最簡單，速度最快。適合 cache、session、計數器。

| 產品 | 特色 |
|---|---|
| Redis | 資料存在記憶體，當 cache 或 message broker |
| DynamoDB | AWS 託管，leaderless replication，自動擴展 |

### Wide-Column（大量寫入）

看起來像表格但每一行的 column 可以不同。適合時序資料、IoT、log。

| 產品 | 特色 |
|---|---|
| Cassandra | Leaderless，LSM-Tree，寫入極快，跨 data center |
| HBase | 跑在 Hadoop 上，適合批次分析 |

### Graph（關係網路）

資料是節點和邊，查詢「A 認識的人裡誰也認識 B」很快。

| 產品 | 特色 |
|---|---|
| Neo4j | 最普及的 graph DB，有自己的查詢語言 Cypher |

### Search（全文搜尋）

用倒排索引（inverted index），對每個詞建立「出現在哪些文件」的對照表。

| 產品 | 特色 |
|---|---|
| Elasticsearch | 分散式搜尋引擎，常搭配 Kibana 做 log 分析 |

## Storage Engine：B+ Tree vs LSM Tree

Storage engine 是 DB 內部用來讀寫磁碟的元件。講 InnoDB 寫入流程，等於在講 storage engine 層怎麼運作。

所有 storage engine 的核心選擇只有兩種：

| | B+ Tree | LSM Tree |
|---|---|---|
| 寫入 | 每筆找到正確位置塞進去（random write） | 先存記憶體，批次寫磁碟（sequential write） |
| 讀取 | 走樹找，3-4 次 IO | 要查 memtable + 多個 SSTable |
| 適合 | 讀多寫少 | 寫入密集 |

哪個 DB 用哪種：

| Storage Engine | 底層結構 | 被誰用 |
|---|---|---|
| InnoDB | B+ Tree | MySQL（預設） |
| PostgreSQL engine | B+ Tree | PostgreSQL |
| RocksDB | LSM Tree | TiKV、CockroachDB、Kafka Streams |
| LevelDB | LSM Tree | Google 出的，RocksDB 的前身 |
| Cassandra engine | LSM Tree | Cassandra |

拆開 InnoDB 寫入流程，就是 B+ Tree engine 的標準步驟：Buffer Pool → WAL → Checkpoint → B+ Tree page。這套機制是 B+ Tree engine 共有的，不只是 MySQL 獨有。

## Managed（雲端託管）

底層是上面某種 DB，雲端廠商幫忙管 replication、backup、scaling。

| 產品 | 底層 | 特殊之處 |
|---|---|---|
| Aurora | MySQL / PostgreSQL | Compute 共用同一份 storage（6 副本跨 3 AZ） |
| Cloud SQL | MySQL / PostgreSQL | GCP 託管，傳統架構 |
| PlanetScale | MySQL + Vitess | 託管 sharding |

## Scaling 方式

| 方式 | 產品 |
|---|---|
| 內建 sharding | MongoDB, Cassandra, DynamoDB, CockroachDB |
| 需要外部工具 | MySQL（Vitess）, PostgreSQL（Citus） |
| 託管 sharding | Aurora（讀寫分離，非資料分片）, PlanetScale（Vitess） |
| 只能垂直擴展 | SQLite, Redis（單機模式） |

## 怎麼選

大部分應用從 PostgreSQL 或 MySQL 開始就對了。遇到特定瓶頸再加：

- 需要 cache → Redis
- 需要全文搜尋 → Elasticsearch
- 寫入量極大 → Cassandra
- schema 變動快、document 結構 → MongoDB
- 關係網路查詢 → Neo4j
- 分析型查詢、億級資料聚合 → ClickHouse / BigQuery / Redshift
