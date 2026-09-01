---
title: "Split Brain"
slug: split-brain
brief: "同時出現兩個 leader 一定會吵架，各寫各的、互不相讓，資料一致性就壞了。"
date: 2026-03-16
---

# Split Brain

> 分散式系統的故障模式。Leader-follower 和 consensus 架構都可能遇到。

## 什麼是 split brain

網路一斷，叢集就分成兩邊。兩邊各自選出自己的 leader，各自接受寫入。等網路恢復，兩邊的資料對不上了。

```text
正常時：
  [Leader] ←→ [Follower A] ←→ [Follower B]

網路斷掉：
  [原 Leader] ←→ [Follower A]     |     [Follower B → 自選為 Leader]
  各自接受寫入...                   |     各自接受寫入...

網路恢復：
  兩邊的資料不一致，誰是對的？
```

## 為什麼會發生

Leader-Follower 架構裡，follower 透過 heartbeat 判斷 leader 是否存活。收不到 heartbeat → 認為 leader 掛了 → 發起選舉。

但「收不到 heartbeat」不代表 leader 真的掛了。可能只是網路延遲或暫時斷開。原 leader 還活著、還在接受寫入，另一邊已經選出新 leader。兩個 leader 同時存在 = split brain。

## 怎麼防

### Quorum（多數決）

Raft 的做法：選舉和寫入都需要多數節點同意。

3 個節點分成 2:1 兩邊：
- 2 個的那邊湊得到多數 → 選出新 leader → 繼續服務
- 1 個的那邊湊不到多數 → 無法選舉 → 停止接受寫入

少數派自動停擺，不會出現兩個 leader。

### Fencing Token

分配一個遞增的 token 給每任 leader。舊 leader（token=5）回來後嘗試寫入，storage 層發現已經有 token=6 的寫入 → 拒絕 token=5 的操作。

```text
Leader A (token=5)：我要寫入
Storage：最新 token 是 6，拒絕
Leader B (token=6)：我要寫入
Storage：OK
```

### STONITH（Shoot The Other Node In The Head）

最暴力的做法。偵測到可能 split brain 時，直接強制關閉另一台機器（透過 IPMI、PDU 斷電等硬體手段）。讓舊 leader 徹底停掉，不會繼續寫。

傳統 HA（High Availability）叢集常用。名字很暴力但有效。

## 各系統怎麼處理

| 系統 | 防 split brain 的方式 |
|---|---|
| etcd / Raft | Quorum。少數派無法選舉、無法寫入 |
| MongoDB | Raft 選舉。少數派的 primary 自動降級 |
| Kafka | ISR 機制。leader 掛了從 ISR 裡選新的，不在 ISR 的不能選 |
| Redis Sentinel | Sentinel 投票決定 failover，但有短暫窗口可能 split brain |
| PostgreSQL + Patroni | 用 etcd/ZooKeeper 當 distributed lock，搭配 fencing |

---

Split brain 是兩個 leader 同時存在的故障。用 quorum 讓少數派自動停擺，是最常見的防護方式。
