---
title: "Unique ID Generation"
slug: unique-id
brief: "UUID 太長、auto-increment 不跨機器。Snowflake 用 timestamp + machine + sequence 解決。"
date: 2026-03-19
updated: 2026-07-20
revisions: 1
---

# Unique ID Generation

> 分散式系統裡，多台機器同時產生 ID，不能撞，最好還能排序。

## Auto-Increment 為什麼不夠

單機 MySQL 的 `AUTO_INCREMENT` 很簡單。但多台 DB 各自 +1，ID 會撞。

常見 workaround：每台 DB 用不同步長（A 產生 1, 3, 5... B 產生 2, 4, 6...）。可以用，但加第三台機器時步長要全部改，而且 ID 無法反映時間順序。

## UUID

128-bit 隨機值，碰撞機率極低，不需要協調。

```text
550e8400-e29b-41d4-a716-446655440000
```

問題：36 字元太長，當 DB primary key 時 index 膨脹。完全隨機，沒有時間順序，B-tree 寫入變成隨機插入，效能差。

UUIDv7 改善了這點：前 48 bit 是 timestamp，保留了時間順序。但長度仍然是 128 bit。

## Snowflake

Twitter 在 2010 年公開的 ID 格式設計，不是套件或服務。各語言自己實作這個演算法（Node: `snowflake-id`、Go: `bwmarrin/snowflake`、Java: `Hutool IdWorker`）。核心就是一個 function：吃進 timestamp + machine ID，吐出 64-bit 整數，可以直接當 `BIGINT` primary key。

```text
| 1 bit | 41 bit      | 10 bit     | 12 bit   |
| 未用  | timestamp   | machine ID | sequence |
```

- **41 bit timestamp**：毫秒精度，從自訂 epoch 開始算，可用約 69 年
- **10 bit machine ID**：最多 1024 台機器（可拆成 datacenter ID + worker ID）
- **12 bit sequence**：同一毫秒內的序號，每毫秒最多 4096 個 ID

一台機器每秒可產生 400 萬個 ID，不需要跟任何人協調。

```text
timestamp:  0000...10110100101  (2026-03-19T15:30:00)
machine:    0000001010          (machine #10)
sequence:   000000000001        (第 1 個)

→ 組合成一個 64-bit 整數
```

ID 自帶時間排序：timestamp 在最高位，晚產生的 ID 一定比早產生的大。對 B-tree index 友善，寫入永遠是 append。

## 為什麼 Snowflake 需要 Machine ID

64 bit 的空間不夠大，不能像 UUID v4 那樣靠「128-bit 隨機到不會撞」。Snowflake 靠 machine ID 區分不同機器，確保同一毫秒內不同機器產的 ID 不會重複。

```text
沒有 machine ID：
  Server A 在 14:00:00.001 產 ID → timestamp + sequence = 6820001
  Server B 在 14:00:00.001 產 ID → timestamp + sequence = 6820001
  → 撞了

有 machine ID：
  Server A (machine=1) → 68200010001
  Server B (machine=2) → 68200020001
  → 不撞
```

「machine」不限於實體機器，K8s 裡通常對應到一個 pod。10 bit = 最多 1024 個同時產 ID 的 instance。

分配方式：環境變數寫死（最簡單）、啟動時從 DB 領號、用 etcd/ZooKeeper 分配、或用 pod name hash。設定一次就不用管。

## Snowflake 的限制

**時鐘回撥**：NTP 校時把時鐘往回調，可能產生重複 ID。實務做法是偵測回撥後暫停出 ID，等時鐘追上。

**Machine ID 上限**：10 bit 只有 1024 個。超過要改 bit 分配（壓縮 sequence 或 timestamp）。

## UUID v4 vs Snowflake 的不撞策略

```text
UUID v4：  空間大到隨便撒都不會撞（128-bit random）
Snowflake：空間小，用規則分配確保不撞（machine ID 區隔）
```

## ULID

Snowflake 的替代方案。128-bit，但前 48 bit 是 timestamp（毫秒），後 80 bit 是隨機值。

```text
01ARZ3NDEKTSV4RRFFQ69G5FAV
```

比 UUID 短（26 字元 Crockford Base32），有時間排序，不需要 machine ID 分配。缺點是 128 bit 仍然比 Snowflake 的 64 bit 大一倍。

## 選擇

| 方案 | 大小 | 排序 | 需要協調 | 適合場景 |
|---|---|---|---|---|
| Auto-increment | 32/64 bit | 單機有序 | 單機不需要 | 單機 DB |
| UUID v4 | 128 bit | 無序 | 不需要 | 不在意排序的場景 |
| UUID v7 | 128 bit | 時間排序 | 不需要 | 需要排序但不想管 machine ID |
| Snowflake | 64 bit | 時間排序 | machine ID | 高吞吐、需要緊湊 ID |
| ULID | 128 bit | 時間排序 | 不需要 | Snowflake 但不想管 machine ID |

## Benchmark

實測 BIGSERIAL vs UUID v4 vs UUIDv7 的 INSERT 速度、index 大小、range query 效能：[Benchmark Lab](/benchmark)

---

沒人居中協調、又要全域唯一，這就是分散式 ID 的難處。Snowflake 用 timestamp + machine ID + sequence 壓進 64 bit，是高吞吐場景的標準解法。
