---
title: "Raft"
slug: raft
brief: "Leader 選舉 + log 複製。設計上就是要讓人看得懂。"
date: 2026-03-09
updated: 2026-07-20
revisions: 1
---

# Raft

Raft 是分散式共識演算法：讓一群節點對每一筆資料變更達成一致，少數機器掛掉也不影響結論。[Paxos](chunk://paxos) 早就把這題解了，只是很難懂；Raft 做一樣的事，設計目標很單純，讓人看得懂。

## 四個核心

**1. Leader election**
只有一個 leader 能接受寫入。Leader 定期送 heartbeat。沒收到就超時，發起選舉。隨機超時打破平手。

**2. Log replication**
Leader 把每筆操作寫進 log，複製給所有 followers。Log 是 append-only，有序，不能改中間。

**3. Quorum（多數決）**
3 個節點，寫進 2 個就算成功。容許 1 個掛。5 個節點容許 2 個掛。

**4. State machine**
Log 重播成狀態。每個節點同一份 log → 重播後得到同一份 state。

## Trade-offs

- Understandable — 比 Paxos 好懂，實作更直接
- Strong consistency — 所有節點看到一樣的資料
- Leader failover 幾百毫秒，client 幾乎感覺不到
- 寫入需要多數決，latency 高於單節點
- leader 一台處理所有寫入，瓶頸就在這
