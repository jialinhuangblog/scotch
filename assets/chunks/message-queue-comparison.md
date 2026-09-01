---
title: "Queue 選型"
slug: message-queue-comparison
brief: "Kafka、RabbitMQ、SQS 底層設計不同，選錯了事後很難換。"
date: 2026-03-28
updated: 2026-07-20
revisions: 4
article: message-system-axes
---

## 各家的差別

| 工具 | Pattern | 訊息消費後 | 適合 |
|---|---|---|---|
| Kafka | Pub/Sub + Fan-out | 留著（依 retention） | Event streaming、replay、多 consumer |
| RabbitMQ | Point-to-Point / Pub/Sub | 刪掉 | 任務分發、work queue |
| SQS | Point-to-Point | 刪掉 | AWS 生態、competing consumers |
| SNS | Pub/Sub + Fan-out | — | 一發多收，常搭 SQS |
| Redis pub/sub | Pub/Sub | 不存（發完即丟） | 低延遲、subscriber 不在線就丟 |
| MQTT（協定，配 Mosquitto/EMQX） | Pub/Sub | 依設定（可 retain） | IoT、低頻寬裝置 |

## 選型邏輯

**需要 replay**（consumer 掛了要補讀、多個 consumer 各自讀）→ Kafka。訊息是 log，不會因為被讀過就刪掉。

**需要任務只被處理一次**（job queue、email 發送）→ RabbitMQ 或 SQS。訊息被 ack 後刪除，不會被兩個 worker 重複處理。

**在 AWS 生態**→ SQS（queue）+ SNS（broadcast）。Managed service，不用維護 broker。

**低延遲、可以丟**（即時通知、live feed）→ Redis pub/sub。subscriber 不在線的訊息直接丟，不持久化。

## 常見誤解

Kafka 底層是 append-only log，容易跟「logging（記錄系統事件）」混淆。兩個是不同概念：Kafka 是通訊 broker，logging 是 debug 工具。名字看起來像，用途其實完全不同。

**MQTT 是協定，不是 broker。** MQTT 自己不會跑，要配 Mosquitto、EMQX 這類 broker。表裡其他項目都是產品，MQTT 是以「協定＋broker」的組合放進來比較的。

**Pub/sub 的「丟掉」不是有人拿走才刪。** Queue（point-to-point）是 consumer ack 之後 broker 才刪；pub/sub 是 broker 把訊息複製給每一個在線訂閱者，送完就不保留。一個訂閱者收到不影響其他人；發布當下不在線的，永遠錯過。
