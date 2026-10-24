---
title: "DB Landscape"
slug: db-landscape
brief: "SQL, NoSQL, storage engines, managed: what each one is and when to use it."
date: 2026-03-15
updated: 2026-10-17
revisions: 3
---

# DB Landscape

## SQL (relational)

Data lives in tables and is queried with SQL. There is a schema, there are JOINs, there are transactions (ACID).

| Product | What stands out | Common use |
|---|---|---|
| MySQL (InnoDB) | The most widespread RDBMS | The default choice for web apps |
| PostgreSQL | The most complete feature set, highly extensible | Advanced features needed (JSON, GIS, Full-text) |
| SQL Server | Microsoft ecosystem | .NET enterprise apps |
| SQLite | Embedded, the whole DB is one file | Mobile apps, desktop apps, prototypes |

## NoSQL

No SQL, or no enforced schema.

### Document (stores JSON documents)

Flexible schema; each record can have a different structure. Suits apps whose requirements change fast.

| Product | What stands out |
|---|---|
| MongoDB | The most widespread NoSQL, sharding and replica sets built in |
| CouchDB | Supports multi-leader replication, offline-first design |

### Key-Value (look up a key, get a value)

The simplest structure and the fastest. Suits caches, sessions, counters.

| Product | What stands out |
|---|---|
| Redis | Data lives in memory; used as a cache or message broker |
| DynamoDB | Managed by AWS, shards and scales on its own |

### Wide-Column (heavy writes)

Looks like a table, but each row can have different columns. Suits time series data, IoT, logs.

| Product | What stands out |
|---|---|
| Cassandra | Leaderless, LSM-Tree, very fast writes, spans data centers |
| HBase | Runs on HDFS, random real-time reads and writes over Hadoop data (the Bigtable model) |

### Graph (networks of relationships)

Data is nodes and edges. "Among the people A knows, who also knows B" is a fast query.

| Product | What stands out |
|---|---|
| Neo4j | The most widespread graph DB, with its own query language Cypher |

### Search (full text search)

Uses an inverted index: for every word, a table of which documents it appears in.

| Product | What stands out |
|---|---|
| Elasticsearch | Distributed search engine, often paired with Kibana for log analysis |

## Storage Engine: B+ Tree vs LSM Tree

The storage engine is the component inside a DB that reads and writes the disk.

Most common storage engines are one of these two structures:

| | B+ Tree | LSM Tree |
|---|---|---|
| Write | Find the right spot for each record and insert it (random write) | Hold in memory first, write to disk in batches (sequential write) |
| Read | Walk the tree, 3-4 IOs | Check the memtable (the write buffer in memory) + several SSTables (sorted files on disk) |
| Suits | Many reads, few writes | Heavy writes |

Which DB uses which:

| Storage Engine | Structure | Used by |
|---|---|---|
| InnoDB | B+ Tree | MySQL (default) |
| PostgreSQL engine | B+ Tree | PostgreSQL |
| RocksDB | LSM Tree | TiKV, Kafka Streams (CockroachDB used it early on, later switched to the compatible Pebble) |
| LevelDB | LSM Tree | From Google, the predecessor of RocksDB |
| Cassandra engine | LSM Tree | Cassandra |

Break down the InnoDB write path and you get the standard steps of a B+ Tree engine: Buffer Pool → WAL (Write-Ahead Log) → Checkpoint → B+ Tree page. This mechanism is shared by every B+ Tree engine, not something only MySQL has.

## Managed (cloud hosted)

Underneath is one of the DBs above; the cloud vendor handles replication, backup, and scaling.

| Product | Underneath | What is different |
|---|---|---|
| Aurora | MySQL / PostgreSQL | Compute shares one storage layer (6 copies across 3 AZs) |
| Cloud SQL | MySQL / PostgreSQL | Managed by GCP, traditional architecture |
| PlanetScale | MySQL + Vitess | Managed sharding |

## Ways to scale

| Approach | Products |
|---|---|
| Sharding built in | MongoDB, Cassandra, DynamoDB, CockroachDB |
| Needs an external tool | MySQL (Vitess), PostgreSQL (Citus) |
| Managed sharding | Aurora (read/write split, not data sharding), PlanetScale (Vitess) |
| Vertical scaling only | SQLite, Redis (single node mode) |

## How to choose

Most apps start with PostgreSQL or MySQL and add pieces when they hit a specific bottleneck:

- Need a cache → Redis
- Need full text search → Elasticsearch
- Very high write volume → Cassandra
- Schema changes fast, document shaped data → MongoDB
- Queries over networks of relationships → Neo4j
- Analytical queries, aggregating hundreds of millions of rows → ClickHouse / BigQuery / Redshift
