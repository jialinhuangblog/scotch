---
title: "Aurora"
slug: aurora
brief: "Aurora 計算跟 storage 分兩層，各用各的機制（leader-follower / quorum）。"
date: 2026-03-26
---

# Aurora

> AWS 的 managed relational DB。相容 MySQL 和 PostgreSQL，但底層 storage 完全重寫。

## 兩層架構

Aurora 把 DB 拆成兩層：計算層（SQL 處理）和 storage 層（資料存放）。傳統 DB 這兩層綁在一起，Aurora 把它們拆開，各自獨立擴展。

```text
計算層（leader-follower）：
  Writer（1 台）— 處理所有寫入
  Reader（最多 15 台）— 處理讀取

Storage 層（quorum）：
  資料切成 10 MB 的塊
  每個塊複製 6 份，分散在 3 個 AZ（每個 AZ 2 份）
  所有 Writer / Reader 共用同一層 storage
```

## Storage：10 MB 的塊 × 6 份

傳統 MySQL replication 是每個節點各存一份完整資料，靠 WAL streaming 同步。Aurora 不同：所有節點共用同一層 distributed storage。

```text
傳統 MySQL：
  Leader  [自己的 SSD] → WAL → Follower [自己的 SSD]
  每個節點各一份，複製有 lag

Aurora：
  Writer  ──┐
  Reader 1 ─┤── 共用 storage（10 MB 塊 × 6 份）
  Reader 2 ─┘
  不用複製資料，replication lag ~10ms
```

100 GB 的資料 → 切成 10,000 個 10 MB 的塊 → 每個塊 6 份 → 60,000 個小塊散佈在不同的 storage node 上。

### Storage 層用 quorum，沒有 leader

Storage 層不選 leader。每個 10 MB 的塊獨立做 quorum：

```text
寫入：6 份裡 4 份確認 → 成功（W=4）
讀取：6 份裡 3 份確認 → 成功（R=3）
W + R = 7 > N = 6 → 讀到的一定包含最新的寫入
```

一個 AZ 整個掛了（丟 2 份），還剩 4 份，寫入照常。壞掉的份數自動修復，不影響其他塊。

```text
Raft/Paxos：選一個 leader，所有寫入經過 leader → etcd、ZooKeeper
Quorum：    不選 leader，每次寫入直接問多數節點 → Aurora storage 層
```

## 計算層：Leader-Follower

Writer 負責寫入，Reader 負責讀取。所有節點共用同一層 storage，不需要複製資料。加 Reader 也不需要複製整份資料，直接讀同一層 storage。

## Failover 怎麼做：promote 一台 reader

Writer 掛了，Aurora 按預設的優先順序（priority tier）直接 promote 排第一的 Reader 成為新 Writer。

```text
Writer（掛了）
Reader 1（priority 0）← 直接 promote 成新 Writer
Reader 2（priority 1）
Reader 3（priority 2）
```

不需要 Raft 選舉，因為 storage 是共用的。新 Writer 接手同一份 storage，不用複製資料、不用追 log、不用跟其他節點達成共識。

**選舉本來就是為了解決「資料分歧」**：傳統複製每個節點各存一份、可能不一致，得靠選舉挑出資料最新的那個當 leader。Aurora 大家共用同一份 storage，沒有分歧要解，所以 promote 哪台都一樣，不用選。

Failover 約 30 秒，慢在 DNS endpoint 切換和 connection 重建，不是選舉。

## 你連的其實是 DNS endpoint

Aurora 給你兩個 endpoint：

```text
Writer endpoint：  mydb.cluster-xxx.rds.amazonaws.com     → 指向 Writer
Reader endpoint：  mydb.cluster-ro-xxx.rds.amazonaws.com  → 指向 Reader

DBeaver 連 Writer endpoint → 看到一個 DB
背後其實有 Writer + 多台 Reader + 6 份 storage
你完全不知道，也不需要知道
```

連 Reader endpoint 也能連上，看到一樣的資料，但只能 SELECT 不能 INSERT/UPDATE。

---

Aurora 把計算層和 storage 層拆開。計算層是 leader-follower（Writer + Reader），storage 層是 quorum（10 MB 塊 × 6 份）。failover 直接把 reader promote 上來，不用選舉，因為 storage 是共用的。
