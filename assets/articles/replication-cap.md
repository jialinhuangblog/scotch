---
title: "資料複製了，然後一致性呢"
slug: replication-cap
date: 2026-03-16
updated: 2026-06-08
revisions: 1
subtitle: "同樣叫「複製」，底下有好幾種架構，混著理解一定鬼打牆。"
chapter: "storage"
tags: [replication, cap, consensus, quorum, distributed-systems]
related: [storage-deep, storage-internal, etcd-raft, scaling-first-move]
---

# 資料複製了，然後一致性呢

一台 DB 存了所有資料。這台機器掛了，資料就沒了。

解法很直覺：把資料[複製](chunk://replication)到多台機器。一台掛了，其他的還有。

問題是「複製」這兩個字背後藏了三個完全不同的架構。每個架構對「寫入怎麼處理」「讀取怎麼處理」「節點掛了怎麼辦」的答案都不一樣。混在一起理解，一定鬼打牆。

---

## 架構一：Leader-Follower

一個 leader 負責所有寫入。Follower 從 leader 複製資料，只接受讀取。

MySQL、PostgreSQL、MongoDB、[Aurora](chunk://aurora) 都用這個架構。

### 寫入怎麼走

```text
Client → Leader → 寫入成功 → 複製給 Follower 1, Follower 2
```

寫入只走 leader。Leader 寫完可以馬上回覆 client（非同步複製），也可以等 follower 確認（同步複製）。大多數系統預設非同步，快但有風險：leader 掛了，最近幾筆寫入可能還沒傳到 follower，丟了。

### 讀取怎麼走

讀 leader 一定拿到最新值。讀 follower 可能拿到舊值（replication lag）。

Aurora 提供兩個 endpoint：writer endpoint 打到 leader，reader endpoint 打到 follower。Application 自己決定每個 query 走哪個。

Lag 的實際問題：使用者發了一篇文章（寫入 leader），馬上刷新頁面（讀到 follower），follower 還沒收到這筆資料，使用者看不到自己剛發的文章。解法叫 read-after-write consistency：剛寫完的資料，下一次讀強制走 leader。其他讀取照常走 follower。

### 節點掛了怎麼辦

Follower 掛了：沒影響，少一台讀取分流而已。回來之後從 leader 補上漏掉的資料。

Leader 掛了：要選新 leader（failover）。選舉期間無法寫入。

選舉怎麼跑？以 Raft 為例。Leader 定期送 heartbeat 給 follower。某個 follower 超過一段時間沒收到 heartbeat，就認定 leader 掛了，發起選舉、投自己一票、跟其他 follower 要票。拿到多數票就當選。

但如果三個 follower 同時發現 leader 掛了，同時發起選舉，每個都投自己，沒人過半，選舉失敗。所以 Raft 讓每個 follower 的超時時間加一個隨機值（例如 150-300ms）。先超時的先發起，其他人還沒超時、沒有競爭者，自然投給它。

```text
Follower A 超時 150ms → 先發起選舉 → 拿到多數票 → 當選
Follower B 超時 280ms → A 已經當選了，不用選
Follower C 超時 310ms → 同上
```

| 產品 | Failover 方式 | 時間 |
|---|---|---|
| MongoDB | Raft 投票，自動選新 primary | 幾秒 |
| MySQL | 手動切換，或用 MHA / orchestrator 自動化 | 幾秒到幾分鐘 |
| PostgreSQL | 手動 promote standby，或用 Patroni 自動化 | 幾秒到幾分鐘 |
| Aurora | AWS 自動偵測並 promote replica | 約 30 秒 |

MongoDB 和 Aurora 內建自動 failover。MySQL 和 PostgreSQL 原生不自動，需要額外工具。Aurora 慢在 30 秒不是因為選舉，是 DNS endpoint 切換和 connection 重建需要時間。

### 一致性保證

讀 leader = 強一致。讀 follower = 最終一致（有 lag）。

### 變體：Multi-Leader

多個節點都能接受寫入，彼此同步。適合跨地域部署（東京和紐約各一個 leader）。問題是兩個 leader 同時改同一筆資料會衝突，需要衝突解決策略。CouchDB 用這種；DynamoDB Global Tables 也是，每個 region 各一個 leader，跨 region 互相同步。

---

## 架構二：Consensus（Raft）

也有 leader，但 leader 的寫入必須經過多數決確認才算成功。

etcd、ZooKeeper、TiKV 用這個架構。

### 寫入怎麼走

```text
Client → Leader → 複製 log 給 Follower 1, Follower 2
                → 2/3 確認（含 leader 自己）→ 回覆 Client「成功」
```

Leader 不能自己說了算。必須等多數 follower 確認收到 log，寫入才算 committed。

這裡又出現了 quorum（多數決）。Quorum 不是某種架構，而是一個計票規則：「夠多人同意才算數」。不同架構都可以用：

- **Consensus（Raft）用 quorum**：leader 寫入後等多數 follower 確認，保證 log 順序一致 → 強一致
- **Leaderless 也用 quorum**：沒有 leader，任一節點寫入後等 W 個確認，只保證「讀得到最新值」 → 最終一致

同樣叫 quorum，但 Raft 的 quorum 確認的是「log 順序」，Leaderless 的 quorum 確認的是「資料有收到」。一致性程度不同。

跟架構一的差別：Leader-Follower 的 leader 寫完就回覆 client（非同步），不等 follower。Raft 的 leader 要等多數確認才回覆。

### 讀取怎麼走

所有節點的 log 順序完全一致。理論上讀任何節點都能拿到一樣的結果。實務上 etcd 預設讀 leader，確保線性一致（linearizable read）。

### 節點掛了怎麼辦

3 個節點掛 1 個：多數還在，繼續運作。5 個節點掛 2 個：多數還在，繼續運作。

Leader 掛了：follower 發起選舉，隨機超時打破平手，幾百毫秒選出新 leader。

只要掛掉的節點過半（3 個裡掛 2 個），叢集就停止服務，因為它寧可停，也不回可能是錯的資料。

### 一致性保證

強一致。所有節點的 log 順序一模一樣，重播後狀態一模一樣。代價是寫入延遲較高（要等多數確認），而且掛太多節點會停擺。

### 同樣是 Leader-Follower 拓樸，歸類卻不同

架構一跟架構二的差別值得再放大一次。etcd 和 Redis 畫出來的架構圖一模一樣：一個 leader，多個 follower。兩個畫出來一樣，但歸成不同類，因為決定權在誰手上不同。

**拓樸**描述的是「誰連誰」。兩個都是 leader 寫，follower 複製。

**歸類**描述的是「誰說了算」。etcd 的 leader 不能自己決定，要多數 follower 同意才算數，所以叫 consensus（共識）。Redis 的 leader 自己說了算，follower 只是被動跟，所以歸類就是 leader-follower。

```text
etcd：  Client → Leader → 等多數 Follower 確認 → 才回 Client 成功
Redis： Client → Leader → 馬上回 Client 成功 → 背景才複製給 Follower
```

| | 拓樸 | 回 client 的時機 | leader 掛了 | 歸類 |
|---|---|---|---|---|
| etcd | leader-follower | 多數 follower 確認後 | 資料不丟，安全選新 leader | Consensus |
| Redis | leader-follower | leader 自己寫完就回 | 可能丟最近的寫入 | Leader-Follower |

k8s 用 etcd 存叢集狀態（絕對不能丟），Redis 拿來做 cache（丟了頂多 cache miss，再查一次）。用途決定了複製策略的選擇。

---

## 架構三：Leaderless

沒有 leader。每個節點都能接受讀和寫。

Cassandra、DynamoDB 用這個架構。

### 寫入怎麼走

```text
Client → 同時寫 Node A, Node B, Node C
       → W=2 個確認 → 寫入成功
```

沒有固定的 leader。Client（或 coordinator 節點）把寫入送給多個節點，等 W 個確認就算成功。

### 讀取怎麼走

```text
Client → 同時問 Node A, Node B
       → 拿到兩個回應 → 挑版本最新的
```

Client 問 R 個節點，可能拿到不同版本的資料，挑最新的。

W + R > N（節點總數）保證讀到的人裡至少有一個參與過最近的寫入。數學上一定有交集。

W 和 R 是兩個可以自己調的設定：調高（趨近 W=R=N）更偏一致，讀得到剛寫的；調低更偏快、偏可用。但再怎麼調，也給不了 consensus 那種強一致，這是架構的天花板。

### 節點掛了怎麼辦

不需要選舉。掛幾個都能繼續運作，只要還有 W 個節點能寫、R 個節點能讀。掛太多導致達不到 W 或 R 的門檻，那個操作才會失敗。

### 一致性保證

最終一致。不同節點可能暫時有不同的值。讀取時靠 quorum 拼湊出最新值，但不保證順序。兩個 client 同時寫同一筆資料，可能出現衝突，需要衝突解決策略（例如 last-write-wins）。

寫的當下各節點各自獨立，事後靠背景同步（gossip、read-repair、hinted handoff）慢慢收斂到一致。

### 為什麼 RDB（關聯式資料庫）不用 Leaderless

RDB 需要 transaction（ACID）。Transaction 要求「這三筆寫入全部成功或全部失敗」，需要嚴格的順序控制。Leaderless 架構沒有統一的順序，每個節點各自收寫入，無法協調 transaction 的 commit 或 rollback。

所以 MySQL、PostgreSQL、Aurora 都是 Leader-Follower：所有寫入經過同一個 leader，leader 負責 transaction 的順序。Leaderless 用在不需要 transaction 的場景：Cassandra 存 log、DynamoDB 存 session。

---

## 強一致 vs 最終一致

這兩個詞在上面反覆出現。具體差在哪：

**強一致（Strong Consistency）**：寫入成功後，任何人、從任何節點讀，都一定拿到最新值。好像只有一台機器。

**最終一致（Eventual Consistency）**：寫入成功後，短時間內有些節點還沒收到。過一段時間（通常幾毫秒到幾秒），所有節點最終會同步到一致。

```text
強一致：
  T=1  寫入 name="Carol"
  T=2  任何節點讀 → 一定是 "Carol"

最終一致：
  T=1  寫入 name="Carol"
  T=2  Node A 讀 → "Carol"（已同步）
       Node B 讀 → "Bob"（還沒同步）
  T=3  Node B 讀 → "Carol"（同步完成）
```

強一致的代價是慢（要等多數確認）。最終一致的代價是短暫不一致（使用者可能看到舊值）。

大部分使用者場景能接受最終一致。社群貼文晚幾秒才被其他人看到，沒關係。但銀行轉帳不行，扣了錢對方一定要馬上看到。

---

## 三種架構，一張表

| | Leader-Follower | Consensus（Raft） | Leaderless |
|---|---|---|---|
| 代表產品 | MySQL, Aurora, MongoDB | etcd, ZooKeeper, TiKV | Cassandra, DynamoDB |
| 寫入走誰 | Leader | Leader（等多數確認） | 任一節點（等 W 個確認） |
| 讀取走誰 | Leader 或 Follower | 任一節點（通常走 Leader） | 任 R 個節點 |
| Leader 掛了 | Failover 選新 leader | 投票選新 leader | 不需要，沒有 leader |
| 一致性 | 讀 leader 強一致，讀 follower 最終一致 | 強一致 | 最終一致 |
| Quorum 用在哪 | 不用 | 寫入確認 | 讀和寫都用 |
| 適合場景 | 一般 Web 應用 | 需要強一致的 metadata（k8s 狀態、設定） | 寫入量大、跨 region |

---

## CAP：分散式系統逃不掉的取捨

資料複製到多台機器之後，就是分散式系統了。[CAP](chunk://cap) theorem 說：網路斷掉、節點連不上（Partition）一定會發生，發生時只能在一致性（Consistency）和可用性（Availability）之間選一個。

### CP：拒絕服務保證一致

Raft 就是 CP。3 個節點掛了 2 個，剩 1 個不到多數，拒絕寫入。整個系統停擺，但不會出現不一致的資料。

etcd、ZooKeeper、MongoDB（預設配置）都是 CP。

### AP：保持可用性允許不一致

Cassandra 就是 AP。節點之間斷開了，每個節點繼續獨立接受讀寫。資料可能不一致，等網路恢復後再同步修復。

DynamoDB（預設 eventually consistent read）、DNS 都是 AP。

### Leader-Follower 呢？

取決於配置。Aurora 讀 writer endpoint 是 CP 行為（保證一致），讀 reader endpoint 是 AP 行為（可能拿到舊值但不會停）。

---

## 回到最初的問題

「資料複製了，然後一致性呢？」

答案取決於選了哪種架構：

- **Leader-Follower**：讀 leader 就一致，讀 follower 就可能不一致。簡單，大部分場景夠用。
- **Consensus**：所有節點一致，代價是慢和容錯上限（掛太多就停）。適合不能有任何分歧的場景。
- **Leaderless**：快、容錯高，但一致性最弱。適合寫入量大、能接受短暫不一致的場景。

大部分系統從 Leader-Follower 開始。等到某次不一致真的造成損失，才值得付 consensus 的成本；寫入量大到單一 leader 處理不來，才輪到 leaderless。
