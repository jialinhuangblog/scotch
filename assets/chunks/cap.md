---
title: "CAP"
slug: cap
brief: "CAP 不是三選二。網路斷掉時，只能在一致性和可用性之間選一個。"
date: 2026-03-15
updated: 2026-08-02
revisions: 1
article: replication-cap
---

# CAP（Consistency, Availability, Partition Tolerance）

> 分散式系統理論，不限於 DB。任何多節點系統（DB、message queue、cache cluster）都適用。

分散式系統一旦網路斷掉、節點之間連不上，就只能在一致性和可用性之間選一個。

## 三個字母

- **C（Consistency）**：每次讀都拿到最新寫入的值。所有節點在同一時間看到同一份資料。
- **A（Availability）**：每個請求都能收到回應（不是 error），不保證是最新值。
- **P（Partition Tolerance）**：網路斷掉、節點之間連不上時，系統還能繼續運作。

## 真正在選的不是三個

「三選二」這個說法有誤導。P 不能放棄，因為分散式系統一定會遇到網路斷掉、節點連不上。真正要選的是：**當 partition 發生時，選 C 還是 A？**

沒有 partition 的時候，C 和 A 可以同時滿足。

## CP 和 AP

**CP 系統**：partition 發生時，寧可拒絕請求（犧牲 A），也要保證資料一致。

- etcd、ZooKeeper、HBase
- MongoDB（預設配置）：寫入只走 primary。Primary 跟 secondary 斷開時，少數派的 secondary 拒絕讀寫（選了 C）

**AP 系統**：partition 發生時，每個節點繼續回應（保證 A），但不保證資料一致。

- Cassandra、DynamoDB、CouchDB
- DNS：每個 DNS server 獨立回應，TTL 過期前可能返回舊 IP

## MongoDB 的 CAP

面試常問：「MongoDB 是 CP 還是 AP？」

預設配置下，MongoDB replica set 只有 primary 接受寫入。Partition 發生後，少數派分區的 primary 會被降級，新的 primary 在多數派分區選出。少數派分區暫時無法寫入，選了 C。

但 MongoDB 允許從 secondary 讀。這個行為由 driver 的 `readPreference` 設定控制：

```
readPreference: "primary"    → 只讀 primary → CP（一致，但 primary 掛了就讀不到）
readPreference: "secondary"  → 可以讀 secondary → AP（不會停，但可能讀到舊值）
```

在 connection string、driver config、或 `mongosh` 裡都能設。所以同一個 MongoDB replica set，`readPreference` 設 `primary` 是 CP，設 `secondary` 就變成 AP。

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
| Cassandra、DynamoDB | A | L | PA/EL：偏向快、能用 |
| 傳統 RDB、帳務系統 | C | C | PC/EC：偏向對 |

partition 一年可能只發生幾次，但「讀 replica 換低延遲」每次讀都在選，CAP 沒涵蓋到這部分。
