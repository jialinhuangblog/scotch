---
title: "PK 選型：UUID vs Incremental"
slug: primary-key-choice
brief: "UUIDv4 當 InnoDB 的 PK 會不斷 page split，隨機讀進的 page 還會把 hot data 擠出 buffer pool；解法是 UUIDv7、雙 key，或換 heap 模型。"
date: 2026-07-20
---

# PK 選型：UUID 還是 incremental？

[Clustered index](chunk://clustered-index) 有三個好處：PK 查詢一次到位、range scan 連續讀、寫入 sequential append 不 page split。這三個好處對不同的 PK 選擇，能拿到幾個？

| 好處 | incremental ID | UUIDv4 (隨機) |
|---|---|---|
| PK lookup 一次到位 | ✓ | ✓ |
| Range scan 連續讀 | ✓ | 用不到（誰會 `WHERE uuid BETWEEN`）|
| Sequential insert | ✓ | ✗ |

UUIDv4 只拿到第一個。range scan 對 UUID 沒有意義，因為沒人會按 UUID 範圍查詢；sequential insert 則完全失去。

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

[Percona 的實驗](https://www.percona.com/blog/illustrating-primary-key-models-in-innodb-and-their-impact-on-disk-usage/)裡，auto-increment PK 的 page 大約填到九成，隨機 UUID PK 因為 page 一直分裂，只填到五成左右，同樣的資料多用了兩到三倍的磁碟空間。

## 解法

**1. 用時序 UUID（UUIDv7 / ULID）**

前 48 bit 是 timestamp，後面是隨機。視覺上還是 UUID，實際上單調遞增：

```text
UUIDv4 隨機:    a7f3... 2b1c... f4d9...     ← 位置到處跳
UUIDv7 時序:    01860... 01861... 01862...  ← 有序 append
```

INSERT 又變回 sequential append，寫入效能接近 auto-increment。

**2. 雙 key 策略**

PK 用 auto-increment，讓 InnoDB 的 INSERT 維持 sequential append，UUID 當 secondary key 給外部用：

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

## 結論

Clustered index 能運作的條件很寬鬆，任何可以排序的 key 都行。但拿到全部效能好處的前提，是 key 要單調遞增。
