---
title: "SQS 也能收發訊息，為什麼還要 RabbitMQ"
slug: rabbitmq-routing
date: 2026-07-12
subtitle: "RabbitMQ 跟 SQS 一樣會刪訊息，差別在 producer 和 queue 中間多一層 exchange。這一篇看那層路由換到什麼。"
chapter: "messaging"
tags: [rabbitmq, exchange, routing, amqp, message-queue, system-design]
related: [message-system-axes, sns-sqs, why-kafka, queue-peak-shaving]
---

# SQS 也能收發訊息，為什麼還要 RabbitMQ

[SNS+SQS](article://sns-sqs) 已經能解耦、能削峰、能 DLQ，該有的都有了。RabbitMQ 也是刪訊息這一派，看起來做的是同一件事。那它多的是什麼？

先定位四題（[四題是哪四題](article://message-system-axes)）。RabbitMQ 送法可 point-to-point 可 pub/sub、位置在後端、存法是 ack 完就刪，這幾題都跟 SQS 同一側，跟 [Kafka 的「留」](article://why-kafka)相反。真正不一樣的是一個 SQS、Kafka 都沒有的東西：producer 不直接寫 queue，中間隔了一層 [exchange](chunk://exchange)。

這一層帶來的是路由彈性：哪則訊息進哪些 queue，變成一條隨時能改的規則，寫在 broker 上，不寫在 producer 裡。

---

## producer 不知道 queue 是誰

SQS 的 producer 要指定送進哪個 queue，Kafka 的 producer 要指定寫進哪個 topic。兩邊 producer 都得知道下游長怎樣。

RabbitMQ 把這件事翻過來。producer 只把訊息丟給一個 exchange，帶一個 routing key，然後就不管了。queue 這邊各自用一條 binding 綁到 exchange 上，binding 帶著「我要收哪種」的條件。訊息進 exchange，比對每條 binding，符合的 queue 收一份。

差別在誰認識誰。SQS 是 producer 認識 queue，RabbitMQ 是 queue 認識 exchange，producer 什麼 queue 都不用認。想多一個下游，去 exchange 加一條 binding，producer 一行不用動。

```python
# queue 自己綁到 exchange，帶上要收哪種的條件
channel.exchange_declare('orders', 'topic')
channel.queue_bind(queue='payments', exchange='orders', routing_key='order.*.paid')

# producer 只丟給 exchange，不認識任何 queue
channel.basic_publish(exchange='orders', routing_key='order.us.paid', body=msg)
```

---

## 三種 exchange 就是三種路由規則

路由規則全看 exchange 的型別，RabbitMQ 有三種（[exchange](chunk://exchange)）：

- **fanout**：不看條件，全部複製給綁上來的 queue。這就是 [SNS 的一發多收](article://sns-sqs)，RabbitMQ 內建同樣的能力。
- **direct**：routing key 完全相等才送。`severity=error` 的只進 error queue，精確分流。
- **topic**：routing key 用點分段，binding 能用萬用字元。`order.*.paid` 收所有地區的付款事件，`order.#` 收訂單的一切。

SNS 只會 fanout，Kafka 靠 topic 加 partition 分流。RabbitMQ 這三種擺在同一個 broker，direct 和 topic 這種按內容決定去向的路由，是它最強的地方，別家要做到不容易。

---

## broker 主動推，用 prefetch 限流

還有一個跟 SQS、Kafka 都不同的地方：推拉。Kafka 和 SQS 是 consumer 自己去拉（pull），RabbitMQ 是 broker 主動把訊息推給 consumer（push）。

推有一個風險：broker 一口氣推太多，consumer 吃不下就積在記憶體裡。RabbitMQ 用 prefetch 處理：設定一個 consumer 同時最多幾則還沒 ack，到上限 broker 就停手，等它 ack 幾則再繼續推。這是 push 模型自己補的一道流量控制。

至於分工，跟 SQS 同路：多個 consumer 綁同一個 queue 就是 competing consumers，一則只給一個。處理失敗反覆重試的，一樣進 [DLQ](chunk://dlq) 隔離。

---

## 三個怎麼選

三個產品擺在一起，選哪個就看四題裡的答案：

- 路由規則複雜、要按內容分流、要 topic pattern、要 priority queue → RabbitMQ，那層 exchange 是它獨有的。
- 只是要「一發多收」加託管、在 AWS 生態、不想養 broker → [SNS+SQS](article://sns-sqs) 更省。
- 要 replay、要同一份資料多個下游從頭各讀一遍、要當事件真相 → [Kafka](article://why-kafka)，那是「留」在解的問題。

RabbitMQ 和 SNS+SQS 都是刪訊息那一派，差在 RabbitMQ 多給了一層可程式化的路由。跟 Kafka 的差別更前面：Kafka 把訊息留著，這兩個都刪。
