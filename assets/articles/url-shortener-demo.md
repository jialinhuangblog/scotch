---
title: "看起來只是點個短網址，背後大概有五個元件在跑"
slug: url-shortener-demo
subtitle: "把前三篇講的設計，一個一個落成跑得起來的 code。"
chapter: "url-shortener"
tags: [url-shortener, go, redis, kafka, clickhouse, postgresql, system-design]
date: 2026-03-29
related: [url-shortener-key, url-shortener-store, url-shortener-read]
---

# 看起來只是點個短網址，背後大概有五個元件在跑

前三篇講的是設計跟取捨，這篇把它們接成一個能跑的系統。

這篇是實作總結。用來回憶「當時做了什麼，為什麼這樣做」。

---

## 三篇文章回顧

這個 demo 對應三篇文章，每篇解決一個問題：

- **[怎麼生 key](article://url-shortener-key)**：long_url → short_key，counter vs hash vs random
- **[怎麼存](article://url-shortener-store)**：幾十億條 mapping，讀多寫少，cache 怎麼放
- **[read path](article://url-shortener-read)**：用戶點了之後，流量怎麼走，analytics 怎麼收

---

## 系統一覽

```text
POST /shorten  ─────────────────────────────────────────────────────────
  → id_counter（PG atomic RETURNING）        ← 第一篇：counter 方案
  → base62 encode → short_key
  → PG url_mappings（寫入）
  → Redis url:<key>（pre-warm cache）         ← 第二篇：write-through
  → Redis bloom:urls（SetBit × 5）            ← 第二篇：Bloom filter

GET /:key  ──────────────────────────────────────────────────────────────
  → Bloom filter miss → 404                  ← 第三篇：cache penetration 防禦
  → Redis url:<key> hit  → long_url
                    miss → PG → populate cache
  → Redis INCR clicks:<key>                  ← 第三篇：real-time count
  → hub.Broadcast(key) → SSE 推送 dashboard
  → Kafka click-events（fire-and-forget）     ← 第三篇：async analytics
  → 302 redirect

Background  ─────────────────────────────────────────────────────────────
  consumer:  Kafka → ClickHouse click_events ← 第三篇：analytics pipeline
  flush:     Redis clicks:<key> → PG url_stats 每 5 秒  ← 第三篇：flush pattern
```

---

## 設計決策對照

### Key 生成：DB counter + base62

DB 裡一張 `id_counter` 表，一行：

```sql
UPDATE id_counter SET next_id = next_id + 1 RETURNING next_id;
```

`RETURNING` 是原子操作，多台 server 同時呼叫不會拿到重複的 ID。拿到數字後 base62 encode 成 7 字元的 short_key。

選 counter 不選 hash：不需要碰撞檢查，不需要 Bloom filter 去擋 hash 碰撞。Bloom filter 在這裡是用來擋**不存在的 key**（cache penetration），不是擋 hash 碰撞。

### Bloom filter：自己用 Redis bitset 實作

沒有用 RedisBloom module，用 Redis 的 `SETBIT` / `GETBIT` 自己算：

```text
bloom:urls（Redis string，當作 bitset）

Add(key)：
  hash(key) 算出 5 個 bit 位置 → SETBIT bloom:urls pos 1（×5）

Check(key)：
  GETBIT bloom:urls pos（×5）→ 全部是 1 才算「可能存在」
  有任何一個是 0 → 「一定不存在」→ 直接 404
```

5 個 hash function，用同一個 key 加不同 seed 算出來。False positive rate 約 1%（在可接受範圍）。

### Redis 的三個角色

```text
bloom:urls    string（bitset）  Bloom filter
url:<key>     string            cache：short_key → long_url，TTL 10 分鐘
clicks:<key>  string            click counter，每 5 秒 flush 到 PG
```

三個 key prefix，各自做不同的事。

### Analytics：Kafka → ClickHouse

每次 redirect，click event 丟進 Kafka（fire-and-forget goroutine，不等 ack）。consumer 從 Kafka 讀，batch 寫進 ClickHouse：

```text
goroutine: ReadMessage → parse → detect device → rows channel
main loop: 攢滿 500 筆 or 2 秒到時 → PrepareBatch → Append × N → Send
```

ClickHouse 用 native binary protocol（TCP :9000），不是 SQL text。`PrepareBatch` 發一次 INSERT header，`Append` 每筆 row 串流進去，`Send` 才真的送出。比逐行 INSERT 快很多。

### Real-time dashboard：SSE

每次 redirect，`hub.Broadcast(key)` 推給所有連著 `/stream` 的瀏覽器。瀏覽器收到 key，把對應的 count +1，不需要 polling。

每 10 秒 resync 一次（從 PG total + Redis delta 重新排序），防止長時間 drift。

### Flush：Redis INCR → PG

flush 每 5 秒跑一次：

```text
SCAN clicks:* → GetDel（原子，取出並刪除）
→ INSERT url_stats ON CONFLICT DO UPDATE total_clicks += val
```

`GetDel` 是 atomic 的，不會漏計或重複計。server 重啟最多丟 5 秒的 click count，對 analytics 可以接受。

---

## 跟 production 差在哪裡

| 功能 | Demo | Production |
|---|---|---|
| Key 生成 | 單一 PG counter | counter service（ZooKeeper / etcd range 分配） |
| Bloom filter | Redis bitset 自幹 | RedisBloom module |
| Sharding | 無（單一 PG） | consistent hashing，多個 PG shard |
| CDN | 無 | CDN 快取 302，降低 origin 負擔 |
| Real-time | SSE | SSE or WebSocket |
| Analytics DB | ClickHouse（本地） | ClickHouse cluster |
| Click count | Redis INCR + 5s flush | 同，或加 HyperLogLog 算 unique visitor |

Demo 刻意省掉 sharding 和 CDN，讓每條資料流都看得清楚。核心邏輯和 production 是一樣的。

---

## 怎麼跑起來

```bash
make setup          # 啟動 infra（Docker）+ 建 schema
make run-shortener  # terminal 1
make run-consumer   # terminal 2
make run-flush      # terminal 3
make seed           # 塞 50,000 筆假資料（可重複跑，每次加 50k）
make traffic        # 模擬流量（80/20 Zipf，少數 URL 佔大部分點擊）
```

Dashboard：http://localhost:8080
Analytics：http://localhost:8080/analytics

Reset：`make db-prune`（先停 consumer，否則 buffer 裡的舊 event 會寫進新的 ClickHouse）。
