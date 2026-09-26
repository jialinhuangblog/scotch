---
title: "KRaft"
slug: kraft
brief: "Kafka 不再依賴 ZooKeeper，改用內建的 Raft 管理叢集 metadata。"
date: 2026-06-12
---

# KRaft

> Kafka 一直要在旁邊另外跑一套 ZooKeeper 管 metadata，能不能自己管？

## metadata 改由 Kafka 自己管

早期 Kafka 把叢集的 metadata（有哪些 broker、topic、partition、誰是 controller）存在外部的 ZooKeeper。所以要維運兩套分散式系統，Kafka 跟 ZooKeeper 各自要部署和監控。

KRaft（Kafka Raft）把 metadata 搬進 Kafka 自己。一小群 broker 當 controller，用 [Raft](chunk://raft) 選出 leader，把每次 metadata 變更寫成一條 [log](chunk://the-log)，其他 broker 從這條 log 同步狀態。

像一家公司本來把員工名冊外包給另一家管，KRaft 是把名冊收回自己管，不用再跟外包對接。

## 換來什麼

少跑一套 ZooKeeper、metadata 操作更快、能支援更多 partition、controller 故障切換更快。Kafka 3.3 起 KRaft 可以用在 production，4.0 已經完全移除 ZooKeeper 模式。
