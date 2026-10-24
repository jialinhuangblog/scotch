---
title: "KRaft"
slug: kraft
brief: "Kafka 不再依賴 ZooKeeper，改用內建的 Raft 管理叢集 metadata。"
date: 2026-06-12
updated: 2026-10-17
revisions: 1
---

# KRaft

> Kafka 一直要在旁邊另外跑一套 ZooKeeper 管 metadata，能不能自己管？

## metadata 改由 Kafka 自己管

叢集的 metadata 是「有哪些 broker、哪些 topic、每個 partition 的 leader 在哪台」這類資訊。早期 Kafka 把它存在外部的 ZooKeeper，所以要維運兩套分散式系統，Kafka 跟 ZooKeeper 各自部署、各自監控，broker 啟動還要先連得上 ZooKeeper。

KRaft（Kafka Raft）把 metadata 搬進 Kafka 自己。走一遍建 topic。叢集有 10 台 broker，其中 3 台兼任 controller，這 3 台用 [Raft](chunk://raft) 選出一個 leader。管理員下 `kafka-topics --create --topic orders --partitions 6`，請求送到 controller leader。leader 不是直接改記憶體，而是把「新增 topic orders，6 個 partition，各自的 leader 是哪台」寫成一筆 record，append 到一個內部的 topic `__cluster_metadata`，這就是一條 [log](chunk://the-log)。另外 2 台 controller 複製這筆，過半（2 台）寫入後算 commit。其他 7 台 broker 像一般 consumer 一樣從這條 log 往下讀，讀到這筆就知道 orders 存在、自己要不要當某個 partition 的 leader。

controller leader 掛掉，剩下 2 台用 Raft 重新選一個，新 leader 的 log 跟舊的一樣，不用從別的地方重建。broker 重啟也只要從自己上次讀到的 offset 往下補，不用重新拉整份 metadata。

像一家公司本來把員工名冊外包給另一家管，KRaft 是把名冊收回自己管，不用再跟外包對接。

## 換來什麼

少跑一套 ZooKeeper、metadata 操作更快、能支援更多 partition、controller 故障切換更快。Kafka 3.3 起 KRaft 可以用在 production，4.0 已經完全移除 ZooKeeper 模式。
