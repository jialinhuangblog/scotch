---
title: "Kraft"
slug: kraft
brief: "ZooKeeper 退場。Kafka 自己管 metadata 了。"
date: 2026-06-12
---

# Kraft

> Kafka 一直要在旁邊另外跑一套 ZooKeeper 管 metadata，能不能自己管？

## metadata 搬回家

早期 Kafka 把叢集的 metadata（有哪些 broker、topic、partition、誰是 controller）存在外部的 ZooKeeper。等於要顧兩套分散式系統：Kafka 自己一套、ZooKeeper 一套，ops 變重。

KRaft（Kafka Raft）把 metadata 搬進 Kafka 自己。一小群 broker 當 controller，用 [Raft](chunk://raft) 選出 leader，把每次 metadata 變更寫成一條 [log](chunk://the-log)，其他 broker 從這條 log 同步狀態。Kafka 本來就是 log 起家，現在連自己的 metadata 也用一條 log 管。

像一家公司本來把員工名冊外包給另一家管，KRaft 是把名冊收回自己管，不用再跟外包對接。

## 換來什麼

少跑一套 ZooKeeper、metadata 操作更快、能撐更多 partition、controller 故障切換更快。新版 Kafka 已經預設 KRaft，ZooKeeper 模式逐步退場。

---

KRaft 用內建的 Raft metadata log 取代 ZooKeeper，讓 Kafka 自己管自己的叢集狀態，少一套要顧的系統。
