---
title: "2PC（Two-Phase Commit）"
slug: 2pc
brief: "兩階段提交。最大的弱點是 coordinator 一掛，大家就卡住。"
date: 2026-03-16
---

# 2PC（Two-Phase Commit）

> 分散式 transaction 的協議。跨多個節點的操作需要「全部成功或全部失敗」時使用。

## 問題

轉帳：A 轉錢給 B。如果 users 都在同一台 DB，這就是普通的單機 transaction，DB 自己就保證原子性，不需要 2PC。

問題出在 users 多到一台裝不下、被 [sharding](chunk://sharding) 拆到多台機器之後。A 的帳戶可能落在 DB-1、B 的落在 DB-2，邏輯上同一張 users 表，物理上不同機器。扣 A 的錢（DB-1）、加 B 的錢（DB-2）要同時成功或同時失敗，但兩台機器各自的 transaction 不認識彼此。

## 兩個階段

多一個角色：**Coordinator**（協調者），負責統籌多個節點。

**Phase 1 — Prepare（投票）**

Coordinator 問每個節點：「準備好 commit 了嗎？」

每個節點執行操作（但不 commit），回覆 YES 或 NO。

**Phase 2 — Commit / Abort（執行）**

- 全部回 YES → Coordinator 送 Commit 給所有節點
- 任何一個回 NO → Coordinator 送 Abort 給所有節點，全部 rollback

```text
Coordinator         DB-1（扣 A）      DB-2（加 B）

Phase 1:
  Prepare ─────────→  扣 A，鎖住 row
                       YES ──────────→
  Prepare ──────────────────────────→  加 B，鎖住 row
                                       YES ──────────→

Phase 2:
  Commit ──────────→  commit，解鎖
  Commit ───────────────────────────→  commit，解鎖
```

## Coordinator 掛了

最大的弱點。Phase 1 之後、Phase 2 之前，Coordinator 掛了：

- 節點已經回了 YES，資料鎖住了，等 Coordinator 的指令
- Coordinator 不回來，節點不知道該 commit 還是 abort
- 資料卡在鎖住的狀態，其他 transaction 都被擋住

這叫 **blocking problem**。節點只能等 Coordinator 恢復，或人工介入。

## 3PC 的嘗試

Three-Phase Commit 加了一個中間階段（pre-commit），減少 blocking 的窗口。但實務上很少用，因為：
- 多一個 round trip，更慢
- 網路 partition 時仍然可能不一致
- 大部分系統改用其他方案（Saga pattern）

## 實務中怎麼處理

大部分系統盡量避免跨節點 transaction。常見替代方案：

| 方案 | 做法 |
|---|---|
| Co-locate | 把相關資料放同一個 shard，不需要跨節點 |
| Saga pattern | 拆成多個本地 transaction + 補償操作（失敗時反向 undo） |
| Eventual consistency | 接受短暫不一致，之後靠背景 reconciliation 修正 |

---

2PC 用 Coordinator 統籌多個節點的 commit/abort。Coordinator 是單點故障，掛了所有節點卡住。實務上盡量避免跨節點 transaction。
