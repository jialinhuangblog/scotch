---
title: "etcd 和 Raft：三個節點怎麼不吵架"
slug: etcd-raft
date: 2026-03-09
updated: 2026-06-08
revisions: 1
subtitle: "掛一個沒事，掛兩個就停，多數決決定的。"
chapter: "extras"
tags: [etcd, raft, consensus, distributed-systems]
related: [k8s-planes, the-log, replication-cap]
---

# etcd 和 Raft：三個節點怎麼不吵架

上一篇你看到，k8s 把所有狀態存進 [etcd](chunk://etcd)。etcd 跑在 3 個節點上。如果只寫進 1 個就算數，那個節點掛了，資料就沒了。

所以問題是：寫進幾個才算「成功」？

---

## 多數決：Quorum

3 個全部寫成功才算？那任何一個掛了，整個叢集就不能寫。比 1 個節點還脆弱。

[Raft](chunk://raft) 的答案：**多數決**。3 個節點，寫進 2 個就算成功。這叫 quorum。

- 3 個節點 → quorum 2 → 容許 1 個掛
- 5 個節點 → quorum 3 → 容許 2 個掛

掛掉的節點回來之後，自己從其他節點補上漏掉的資料。

## 一個 Leader，不能多

3 個節點都能寫嗎？不行。

想像 Node A 收到「x = 1」，同時 Node B 收到「x = 2」。誰贏？兩邊都覺得自己對。這叫 **[split brain](chunk://split-brain)** — 兩個 leader，資料分裂。

Raft 的規則：**只有一個 leader 能接受寫入。** 其他節點叫 follower。

```
Client → Leader（寫入）→ 複製給 Follower 1, Follower 2
                        → 2 個確認（含自己）→ 回覆 Client「成功」
```

所有寫入都走同一個 leader，順序自然就固定了，不會打架。

## Leader 掛了：選舉

沒有一個說了算的人，leader 掛了之後，也沒有誰會去安排接班。

Leader 定期送 heartbeat 給 followers。如果某個 follower 一段時間沒收到 — 它認定 leader 掛了，發起投票。

```
Leader 掛了
→ Follower A 超時，發起選舉：「投我」
→ Follower B：「你的資料夠新，OK」
→ Follower A 拿到 2 票 → 當選新 leader
→ 叢集繼續運作
```

整個過程幾百毫秒。Client 幾乎感覺不到。

### 兩個同時選怎麼辦？

A 和 B 同時覺得 leader 掛了，同時發起選舉。A 投自己，B 投自己，各 1 票，誰都沒過半。

Raft 的解法：**隨機超時。** 每個節點在發起選舉前，等一段隨機長度的時間。A 等 150ms，B 等 280ms。A 先發起，B 還沒超時就收到 A 的請求，投給 A。結束。

靠隨機錯開就解決了平手，簡單歸簡單，但管用。

## Log：跟 Kafka 同一個東西

Leader 複製給 follower 的是什麼？不是最終狀態，是 **[log](chunk://the-log)** — append-only、有序、每筆有 index。

```
Index 1: SET x = 1
Index 2: SET y = 2
Index 3: DELETE x
Index 4: SET y = 5
```

跟 Kafka 的 log 同一個概念。Append-only，不能改中間，只能在尾巴加。

Leader 的工作：確保每個 follower 的 log 跟自己一模一樣，順序一模一樣。

```
Leader:     [1: SET x=1] [2: SET y=2] [3: DELETE x]
Follower A: [1: SET x=1] [2: SET y=2] [3: DELETE x]  ← 一致
Follower B: [1: SET x=1] [2: SET y=2]                 ← 少一筆，補上就好
```

Raft 的 log 和 Kafka 的 log 是同一個概念。Append-only，有序，不可變。同一個模式，在好幾個不同領域都會看到。

## 從 Log 到狀態：State Machine

Log 記的是操作。但 etcd 回應查詢時，回的是「x 現在等於多少」。

中間的過程：把 log 一筆一筆重播到一個 key-value store 上。

```
Log:                          State:
[1: SET x=1]  → 執行 →       { x: 1 }
[2: SET y=2]  → 執行 →       { x: 1, y: 2 }
[3: DELETE x] → 執行 →       { y: 2 }
```

這個 state 叫 **state machine**。Raft 的完整名稱：**a consensus algorithm for replicated state machines。**

每個節點都有同一份 log → 重播後得到同一份 state → 每個節點的 key-value store 內容一致。這就是 etcd 保證強一致性的方式。

---

## 四個核心，一張圖

```
          ┌─────────────┐
Client →  │   Leader    │ ← 唯一能寫入的人
          └──────┬──────┘
        複製 log │
       ┌─────────┼─────────┐
       ▼                   ▼
  ┌──────────┐       ┌──────────┐
  │Follower A│       │Follower B│
  └──────────┘       └──────────┘

1. Leader election — 掛了就選舉，隨機超時打破平手
2. Log replication — leader 把 log 複製給 followers
3. Quorum — 多數決，2/3 確認就 commit
4. State machine — log 重播成最終狀態
```

---

## 這篇沒講到的

**Term** — Raft 的「任期」編號。每次選舉 term +1。防止過時的 leader 回來搗亂。

**Log 衝突** — follower 的 log 跟 leader 不一致時怎麼修。Leader 會找到最後一個一致的 index，從那裡覆蓋。

**Snapshot** — log 不能無限長。定期把 state machine 快照存起來，舊的 log 就可以丟了。

**[Paxos](chunk://paxos)** — Raft 之前的共識演算法。正確，但出了名的難懂。Raft 的設計目標就是「讓人能理解」。

這些是從這根主幹長出去的分支。
