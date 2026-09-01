---
title: "PK 選型：UUID vs Incremental"
slug: primary-key-choice
brief: "UUIDv4 配 InnoDB 會拆頁又打散 buffer pool；解法是 UUIDv7、雙 key，或換 heap 模型。"
date: 2026-07-20
---

# PK 選型：UUID 還是 incremental？

[Clustered index](chunk://clustered-index) 有三個好處：PK 查詢一次到位、range scan 連續讀、寫入 sequential append 不拆頁。這三個好處對不同的 PK 選擇，能拿到幾個？

| 好處 | incremental ID | UUIDv4 (隨機) |
|---|---|---|
| PK lookup 一次到位 | ✓ | ✓ |
| Range scan 連續讀 | ✓ | 用不到（誰會 `WHERE uuid BETWEEN`）|
| Sequential insert | ✓ | ✗ |

UUIDv4 只享受到第一個，第二個語意上用不到，到第三個就很糟了。

## UUIDv4 為什麼拖累寫入

Incremental ID 的 INSERT 永遠打到最右邊那個 leaf page：

```text
INSERT id=1001, 1002, 1003, ...
→ 全部進同一個 leaf page（最右邊那片）
→ 填滿後新建下一片，繼續 append
→ Random IO 為零，buffer pool 命中率幾乎 100%
```

UUIDv4 完全隨機，每次 INSERT 打到不同的 leaf page：

```text
INSERT a7f3..., 2b1c..., f4d9..., ...
→ 每次都觸碰不同的 leaf
→ 那片 leaf 如果不在 buffer pool 裡，先從磁碟讀進來（random IO）
→ 如果 leaf 滿了，page split
→ buffer pool 被一堆隨機 page 塞滿，hot data 被擠出去
```

Percona 實測：同樣硬體下，UUIDv4 PK 的 InnoDB 寫入吞吐量可能只有 auto-increment 的 1/5 到 1/10。

## 三個解法

**1. 用時序 UUID（UUIDv7 / ULID）**

前 48 bit 是 timestamp，後面是隨機。視覺上還是 UUID，實際上單調遞增：

```text
UUIDv4 隨機:    a7f3... 2b1c... f4d9...     ← 打到處
UUIDv7 時序:    01860... 01861... 01862...  ← 有序 append
```

Clustered index 的寫入好處回來了，效能接近 auto-increment。

**2. 雙 key 策略**

PK 用 auto-increment，對 InnoDB 最友善，UUID 當 secondary key 給外部用：

```sql
CREATE TABLE users (
  id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid      CHAR(36) UNIQUE,
  ...
);
```

對外 API 只暴露 `uuid`（避免猜 ID 攻擊、合併不同 DB 時不會衝突），內部 JOIN 和外鍵用 `id`。代價是多一個 unique index。

**3. 改用 PostgreSQL**

PostgreSQL 的 heap 模型下 PK 只是 secondary index，UUID 對寫入的衝擊小得多。還是會有 index 碎片問題，但遠沒有 InnoDB 那麼嚴重。

## 一句話

Clustered index 能運作的條件很寬鬆，任何可以排序的 key 都行。但拿到全部效能好處的前提，是 key 要單調遞增。UUIDv4 加 InnoDB，clustered index 在寫入上的好處就沒了。
