---
title: "CAP"
slug: cap
brief: "CAP 不是三選二。網路斷掉時，只能在一致性和可用性之間選一個。"
date: 2026-03-15
updated: 2026-10-18
revisions: 7
article: replication-cap
---

# CAP（Consistency, Availability, Partition Tolerance）

> 分散式系統理論，不限於 DB。任何多節點系統（DB、message queue、cache cluster）都適用。

分散式系統一旦網路斷掉、節點之間連不上，就只能在一致性和可用性之間選一個。

## 三個字母

- **C（Consistency）**：每次讀都拿到最新寫入的值。所有節點在同一時間看到同一份資料。
- **A（Availability）**：每個請求都能收到回應（不是 error），不保證是最新值。
- **P（Partition Tolerance）**：網路斷掉、節點之間連不上時，系統還能繼續運作。

## 要選的不是三個

「三選二」這個說法有誤導。P 不能放棄，因為分散式系統一定會遇到網路斷掉、節點連不上。要選的是：**當 partition 發生時，選 C 還是 A？**

沒有 partition 的時候，C 和 A 可以同時滿足。

## CP 和 AP

分區時看兩件事：少數那一邊收不收寫入，讀到的是不是最新值。同一個系統換了讀法，答案就會變，所以下面每一個都附上設定。

**CP**：少數那一邊不收寫入，讀到的一定是最新值，給不出最新值就回 error（犧牲 A）。

- etcd（預設讀取）：分區後少數那一邊不可用，預設讀取是 linearizable
- MongoDB（readPreference primary）：只有 primary 能完成 majority 寫入，primary 不在就讀不到
- ZooKeeper（預設）：跟多數派斷開的 server 不再回應 client，讀寫都停
- CockroachDB：寫入要多數 replica 同意，少數那邊握有 lease 的那台只在 lease 到期前回讀取，這段時間沒有別人能寫

**AP**：分區時兩邊都繼續收寫入，事後再合併，所以兩邊讀到的值可能不一樣。

- Cassandra（寫入用 ONE）：只要一台 replica 回應就算寫入成功

**兩邊都不是**：少數那一邊拒絕寫入，讀取卻照回，回的可能是舊值。寫入沒有 A，讀取沒有 C。下面這幾個都是一個 leader 收寫入，follower 照自己手上的副本回讀取。

- etcd（serializable read）、ZooKeeper（開 read-only mode 加 local session）、MongoDB（readPreference secondary）、Postgres（允許讀 standby）
- DNS：紀錄只在源頭那台改，其他 DNS server 各自回應，TTL 過期前可能回舊 IP

## RDB 是 CP、NoSQL 是 AP？

一半不成立。單機 Postgres 沒有第二個節點可以分區，根本不在 CAP 的範圍內。加了 replica 之後，選 C 還是 A 看複寫怎麼設計。NoSQL 各種都有；RDB 很少落在 AP，原因是唯一鍵、外鍵、transaction 都要求寫入排成同一個順序，分區時兩邊各收一筆同樣 email 的註冊，合併時唯一鍵就保不住，所以 RDB 的複寫多半只讓一個節點收寫入：

| 分區時 | NoSQL | RDB |
|---|---|---|
| CP | etcd（預設讀取）、ZooKeeper（預設）、MongoDB（readPreference primary）、DynamoDB（strongly consistent read：單一 region、global tables MRSC） | Postgres（同步複寫，讀寫都只走 primary）、CockroachDB |
| 兩邊都不是 | etcd（serializable read）、ZooKeeper（開 read-only mode 加 local session）、MongoDB（readPreference secondary）、DynamoDB（eventually consistent read） | Postgres（允許讀 standby，同步或非同步都一樣） |
| AP | Cassandra（寫入用 ONE）、DynamoDB global tables（MREC） | 少見 |

同步複寫的 Postgres 斷線時，primary 等不到 standby 回應，寫入一直卡著不回。讀寫都只走 primary 的話，standby 那邊什麼都拿不到，這是 CP；允許讀 standby 的話，standby 照自己那份回，可能是舊值，就兩邊都不是。`synchronous_commit` 設 `on` 跟 `remote_apply` 只在平常有差：`on` 只等 standby 把紀錄寫進磁碟，剛寫完去 standby 讀可能還是舊值；`remote_apply` 等 standby 套用完才回。改成非同步複寫也不會變成 AP：Patroni 這類 failover 工具在 primary 更新不了 leader lock 時會把它降成唯讀，分區時只有一邊收寫入。非同步放掉的是 failover 那一刻，primary 上還沒複寫過去的幾筆寫入會不見。

DynamoDB 跟 2007 年的 Dynamo 論文只有名字像。它把資料切成很多份，每一份叫一個 partition（這是資料的切分，不是網路分區），每個 partition 用 Multi-Paxos 選 leader，寫入只走 leader，所以單一 region 在分區時，跟 leader 不同邊的 replica 寫不進去。strongly consistent read 也只走 leader，這種讀法下是 CP。eventually consistent read 的話，那些 replica 還能回讀取，卻可能是舊值，C 也放掉了，CP、AP 都放不進去。跨 region 的 global tables 預設 MREC，每個 region 都收寫入，衝突用 last writer wins 合併，這才是 AP；MRSC 模式要同步到另一個 region 才回，是 CP。Cassandra 讀寫都改用 QUORUM 的話，官方文件寫的是寫入一定會被讀到，往 C 走，代價是少數那一邊也寫不進去了。MongoDB 的讀法見下一節。

## MongoDB 的 CAP

面試常問：「MongoDB 是 CP 還是 AP？」

預設配置下，MongoDB replica set 只有 primary 接受寫入。Partition 發生後，少數派分區的 primary 會被降級，新的 primary 在多數派分區選出。少數派分區暫時無法寫入，選了 C。

但 MongoDB 允許從 secondary 讀。這個行為由 driver 的 `readPreference` 設定控制：

```
readPreference: "primary"    → 只讀 primary → CP（一致，但 primary 掛了就讀不到）
readPreference: "secondary"  → 可以讀 secondary → 兩邊都不是（讀不會停，但可能是舊值；寫入還是只走 primary）
```

在 connection string、driver config、或 `mongosh` 裡都能設。所以同一個 MongoDB replica set，`readPreference` 設 `primary` 是 CP。設 `secondary` 也不會變成 AP，因為寫入還是只有 primary 收，少數那一邊照樣寫不進去，只是讀的那一邊連 C 也放掉了。官方文件的說法是除了 `primary` 以外的讀法「may return stale data」。

## PACELC：CAP 少講了一半

CAP 只回答「partition 發生時怎麼辦」。但 partition 很少發生。沒有 partition 的平常呢？PACELC 補上這一半。念法就是縮寫本身：

```text
if P（分區時）    → A or C
else（平常沒分區） → L or C
```

- 分區時（PAC）：選 A 還是 C。這就是原本的 CAP。
- 平常沒分區（ELC）：選 L（latency，低延遲）還是 C（一致）。

為什麼平常也要選？因為強一致本身有成本，跟分區無關。要保證每個節點看到同一份，寫入就得等 replica 確認才回，這個「等」就是延遲。不想等就非同步複製、讀 replica，比較快，但可能讀到舊的。所以就算網路好好的，強一致跟低延遲每次讀寫都在取捨。

## 一個系統要報兩半

描述一個系統，要同時寫出它分區時跟平常各選了什麼：

| 系統 | 分區時 | 平常 | 取向 |
|---|---|---|---|
| Cassandra（寫入用 ONE） | A | L | PA/EL：偏向快、能用 |
| RDB 同步複寫、帳務系統 | C | C | PC/EC：偏向對 |

partition 一年可能只發生幾次，但「讀 replica 換低延遲」每次讀都在選，CAP 沒涵蓋到這部分。
