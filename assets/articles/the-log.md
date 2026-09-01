---
title: "The Log：就是 echo >> log.txt，結果 Raft / Kafka / WAL / CDC 都可以看到這個簡單機制"
slug: the-log
date: 2026-03-11
subtitle: "Kafka 用它、Raft 用它、資料庫也用它，全為了順序。"
chapter: "extras"
tags: [kafka, log, streaming, raft, consensus, wal]
related: [etcd-raft, storage-deep, compaction-merge]
---

# The Log：就是 echo >> log.txt，結果 Raft / Kafka / WAL / CDC 都可以看到這個簡單機制

[Raft](chunk://raft) 用它讓三個節點達成共識，Kafka 用它重播訊息，資料庫用它在 crash 後復原。差這麼多的系統，底層是同一個機制。

---

## Log 只能往尾巴加

一筆一筆，按照時間順序，只能加在尾巴。不能改中間，不能刪。其實就跟 `echo 一行 >> log.txt` 一樣簡單，一直往檔案尾巴加而已。

```
Index 1: 事件 A
Index 2: 事件 B
Index 3: 事件 C
```

就這麼簡單：只能往後加、有順序、寫了不能改。

這些限制看起來很弱，但任何人拿到同一份 log，從頭重播，都會得到同一個結果。**只要順序定下來，結果就跟著定了。**

分散式系統最難的問題是什麼？是怎麼決定一堆事件的先後順序。傳資料本身反而是小事。Log 把這個問題解掉了。

---

## 走到哪都是 log

**Durability** — 資料庫怕 crash。

解法：寫入任何東西之前，先把「要做什麼」寫進 log（[WAL](chunk://wal)）。Crash 後從 log 重播，狀態恢復。PostgreSQL、MySQL、SQLite 都這樣做。

**Consensus** — 分散式系統怕三個節點各說各話。

解法：用 log 讓所有節點對操作順序達成共識。Raft、[Paxos](chunk://paxos)、ZooKeeper 的 ZAB 協議，底層都是 log。

**Streaming** — 服務之間怎麼傳事件，而且不丟、可重播？

解法：把 log 變成產品本身。Producer 寫進去，Consumer 自己記位置，想重播就重播。Kafka、Pulsar、Kinesis。

**Change propagation** — 資料庫改了，其他系統怎麼知道？

解法：讀資料庫的內部 log（WAL、binlog），把變更發出去。Debezium 就是這樣工作的。這叫 CDC — Change Data Capture。

**Observability** — 系統出問題，怎麼知道發生了什麼？

解法：每個服務把自己的行為寫成 log，集中起來讓人搜尋。Logstash 收集，Elasticsearch 索引，Kibana 視覺化。這是 application log，消費者是工程師，不是系統。

**Audit** — 誰在什麼時間做了什麼？

解法：把每個操作記下來，不可竄改，給合規和資安查。AWS CloudTrail、GCP Audit Logs。

---

## 為什麼最後都用 log

這六個 log 的消費者不同，目的不同，實作不同。

但它們選擇 log 都是**因為順序是可信的**。

只能往後加、改不了中間，所以重播能得到一樣的結果，拿去稽核也賴不掉。

一個極度簡單的結構，在每個領域都解決了「我需要相信這份記錄」的問題。

---

## Jay Kreps 在 2013 年說過

他在 LinkedIn 寫了一篇文章，標題叫《The Log》，副標題是：

> What every software engineer should know about real-time data's unifying abstraction.

他說的不是 Kafka（雖然他是 Kafka 的作者之一）。他說的是這個更底層的東西：log 是一個到處都能用的模式，因為它解決了一個到處都存在的問題。

說到底就是往檔案尾巴一行一行加。
