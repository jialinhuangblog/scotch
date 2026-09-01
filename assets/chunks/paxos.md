---
title: "Paxos"
slug: paxos
brief: "共識演算法的始祖，正確但出了名地難實作。"
date: 2026-03-16
---

# Paxos

> 分散式系統的共識演算法。1989 年 Leslie Lamport 提出。Raft 的前身。

## 解決什麼問題

多個節點要對「某個值是什麼」達成一致。例如：分散式 DB 的多個節點要同意「第 5 筆 log 的內容是 SET x=1」。

跟 Raft 解決的問題一模一樣。差別在怎麼解。

## 三個角色

| 角色 | 做什麼 |
|---|---|
| Proposer | 提案：「我建議這個值是 X」 |
| Acceptor | 投票：「我接受」或「我拒絕」 |
| Learner | 旁觀：「大家決定好了，我記下來」 |

一個節點可以同時扮演多個角色。

## 兩個階段

**Phase 1 — Prepare**

Proposer 選一個遞增的提案編號 N，送 Prepare(N) 給所有 Acceptor。

Acceptor 的回應：
- N 比之前收到的都大 → 回覆「OK，我承諾不再接受比 N 小的提案」
- 否則 → 拒絕

**Phase 2 — Accept**

Proposer 收到多數 Acceptor 的 OK 後，送 Accept(N, value) 給所有 Acceptor。

Acceptor 收到後，如果沒有在這期間承諾更大的編號 → 接受這個值。多數 Acceptor 接受 → 共識達成。

```text
Proposer           Acceptor A    Acceptor B    Acceptor C

Prepare(N=1) ────→  OK
Prepare(N=1) ──────────────────→  OK
Accept(N=1, "X") →  Accepted
Accept(N=1, "X") ─────────────→  Accepted
                                                共識："X"
```

## 為什麼難

1. **多個 Proposer 同時提案**：A 提 N=1，B 提 N=2，A 的 Accept 被拒絕（Acceptor 已承諾 N=2），A 要用更大的 N 再來。可能互相搶，無限循環（livelock）。
2. **沒有固定 leader**：任何節點都能當 Proposer，衝突機率高。
3. **論文難讀**：Lamport 用虛構的 Paxos 島議會比喻來描述演算法。

## Raft 怎麼簡化

Raft 的核心改動：選一個固定 leader，只有 leader 能提案。

| | Paxos | Raft |
|---|---|---|
| 誰能提案 | 任何節點 | 只有 leader |
| 衝突 | 多個 Proposer 互搶 | 不會，一個人提案 |
| 可理解性 | 出了名的難懂 | 設計目標就是讓人能理解 |

實務上幾乎所有新系統都選 Raft（etcd、CockroachDB、TiKV）。Paxos 主要在 Google 內部系統（Chubby、Spanner）。

---

Paxos 先解決了共識，只是難實作；Raft 用固定 leader 把同一件事做得簡單。
