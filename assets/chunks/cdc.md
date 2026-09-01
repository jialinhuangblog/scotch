---
title: "Change Data Capture (CDC)"
slug: cdc
brief: "監聽 DB 的 commit log，把每筆寫入轉成事件流。Debezium 把 Postgres WAL 推到 Kafka。"
date: 2026-04-28
updated: 2026-07-20
revisions: 2
article: search-geo
---

# Change Data Capture

> Postgres 是 source of truth，但搜尋要 Elasticsearch、Cache 要 Redis、analytics 要 ClickHouse。怎麼把寫入同步出去而不雙寫？

## 問題：雙寫不可靠

App 同時寫 Postgres + ES：

```ts
await postgres.insert(listing);
await es.index(listing);  // ← 萬一這裡掛了？
```

Postgres 寫成功，ES 失敗。資料不一致，要寫補償邏輯。網路抖一下、ES 重啟一下，補償就要處理一堆 case。

## CDC：DB 主動把變更推出來

DB 寫入時都會記 [WAL](chunk://wal)（write-ahead log）做 crash recovery。CDC 工具監聽 WAL，把每筆 commit 轉成事件：

```text
Postgres                          Kafka
─────────                         ─────
INSERT listing 101                ┐
  → WAL: { op:'c', after:{...} }  ├→ Debezium 讀 WAL
UPDATE listing 101 price          ├→ 轉成 JSON event
  → WAL: { op:'u', before, after}─┘  push 到 topic
DELETE listing 101
```

App 不用碰 ES、不用碰 Redis、不用碰 ClickHouse。**只寫 Postgres，下游自己訂閱**。

## Debezium 的角色

Debezium 是 Kafka Connect 的 source connector，做兩件事：

1. **首次 snapshot**：把整張表現有資料倒進 Kafka topic
2. **持續 streaming**：之後每筆變更都從 WAL 流出來

接 WAL 的方式不是去讀檔案，是走 Postgres 的 logical replication：Debezium 建一個 replication slot，向 Postgres 表明「我是一個 replica，從這個位置開始給我變更」。Postgres 用 logical decoding（`pgoutput` plugin）把 WAL 裡的物理記錄解碼成一筆一筆的邏輯變更（哪張表、INSERT 還是 UPDATE、before/after 值）餵給它。slot 會記住消費進度，Debezium 斷線重連也不會漏。

下游 consumer 各自寫進 ES、Redis、ClickHouse、data lake。**一個寫入，多個 view**。

```text
                            ┌→ ES Consumer    → Elasticsearch
Postgres ── WAL ── Debezium ─┼→ Cache Consumer → Redis
                            └→ Lake Consumer  → S3 / Iceberg
```

## 為什麼比雙寫好

| 問題 | 雙寫 | CDC |
|---|---|---|
| 一邊失敗 | App 要寫補償 | Kafka retain，consumer retry |
| 順序 | 兩邊各自非同步，可能亂序 | WAL 順序 = Kafka partition 順序 |
| 加新下游 | 改 app code | 加一個 consumer，不動 app |
| App 改 schema | 兩邊都要改 | App 改 Postgres，consumer 各自處理 |

## 一致性是 eventual

CDC 是非同步的：

```text
寫 Postgres 的時間 t=0
WAL flush + Debezium 讀走 t=10ms
推 Kafka t=20ms
ES consumer 寫入 t=2s（ES refresh 1 秒）
```

寫完馬上搜尋可能還沒看到。**1-3 秒 delay 在大多 search、analytics 場景可接受**。要 read-after-write，這條路不適用。

要控制送出去的 event 格式、不直接暴露 DB schema，做法是在 transaction 裡多寫一張 outbox 表，讓 CDC 監聽它，拆在 [Outbox Pattern](chunk://outbox-pattern)。

## 應用場景

- **Search index 同步**：Postgres → ES
- **Cache invalidation**：寫 DB → invalidate Redis key
- **Microservice 解耦**：Order service 寫 DB，Notification / Inventory service 訂閱事件
- **Data warehouse / Lake**：OLTP 資料近即時進 ClickHouse / Snowflake

---

CDC 把「寫多份」的責任從 app code 推給 DB 的 [WAL](chunk://wal)。寫一次，多個下游各自跟上。一致性退成 eventual，但換來比較好的容錯跟解耦。
