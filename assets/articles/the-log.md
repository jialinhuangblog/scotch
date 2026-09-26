---
title: "The Log：就是 echo >> log.txt，Raft / Kafka / WAL / CDC 底層都用這個機制"
slug: the-log
date: 2026-03-11
subtitle: "Kafka、Raft、資料庫底層都是 log，因為寫進 log 的順序不會再變。"
chapter: "extras"
tags: [kafka, log, streaming, raft, consensus, wal]
related: [etcd-raft, storage-deep, compaction-merge]
---

# The Log：就是 echo >> log.txt，Raft / Kafka / WAL / CDC 底層都用這個機制

[Raft](chunk://raft) 用它讓三個節點達成共識，Kafka 用它重播訊息，資料庫用它在 crash 後復原。差這麼多的系統，底層是同一個機制。

---

## Log 只能往尾巴加

Log 按照時間順序一筆一筆寫，新的只能加在尾巴。寫進去的不能改，也不能刪，就跟 `echo 一行 >> log.txt` 一樣，一直往檔案尾巴加而已。

```
Index 1: 事件 A
Index 2: 事件 B
Index 3: 事件 C
```

任何人拿到同一份 log 從頭重播，都會得到同一個結果。

分散式系統裡，幾台機器要對事件的先後順序取得一致。每台都照同一份 log 的 index 重播，得到的順序就相同。

---

## 走到哪都是 log

**Durability** — 資料庫 crash 之後，怎麼恢復到 crash 前的狀態？

解法：寫入任何東西之前，先把「要做什麼」寫進 log（[WAL](chunk://wal)）。Crash 後從 log 重播，狀態恢復。PostgreSQL、MySQL、SQLite 都這樣做。

**Consensus** — 三個節點怎麼對同一串操作的順序取得一致？

解法：用 log 讓所有節點對操作順序達成共識。Raft、[Paxos](chunk://paxos)、ZooKeeper 的 ZAB 協議，底層都是 log。

**Streaming** — 服務之間怎麼傳事件，而且不丟、可重播？

解法：把 log 變成產品本身。Producer 寫進去，Consumer 自己記位置，想重播就重播。Kafka、Pulsar、Kinesis。

**Change propagation** — 資料庫改了，其他系統怎麼知道？

解法：讀資料庫的內部 log（WAL、binlog），把變更發出去。Debezium 就是這樣工作的。這叫 CDC（Change Data Capture）。

**Observability** — 系統出問題，怎麼知道發生了什麼？

解法：每個服務把自己的行為寫成 log，集中起來讓人搜尋。Logstash 收集，Elasticsearch 索引，Kibana 視覺化。這是 application log，消費者是工程師，不是系統。

**Audit** — 誰在什麼時間做了什麼？

解法：把每個操作記下來，不可竄改，給合規和資安查。AWS CloudTrail、GCP Audit Logs。

---

## 為什麼最後都用 log

這六種 log 的消費者跟目的都不一樣，但選擇 log 都是**因為順序是可信的**。

只能往後加、改不了中間，所以重播能得到一樣的結果，拿去稽核時，記錄也不會被事後改掉。

---

## Jay Kreps 在 2013 年說過

他在 LinkedIn 寫了一篇文章，標題叫《The Log》，副標題是：

> What every software engineer should know about real-time data's unifying abstraction.

文章主題不是 Kafka（雖然他是 Kafka 的作者之一），而是 log 這個通用模式：資料庫、共識、串流都要處理事件的順序，所以都用得上它。
