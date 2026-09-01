---
title: "RabbitMQ Exchange"
slug: exchange
brief: "producer 不直接寫 queue，先丟給 exchange，exchange 按綁定規則決定這則進哪幾個 queue。"
date: 2026-07-12
article: rabbitmq-routing
---

# RabbitMQ Exchange

> producer 想發一則訊息，但哪些 queue 該收，規則常常在變。要怎麼讓 producer 不用認識這些 queue？

## 中間多一層路由

Kafka 的 producer 直接寫進某個 topic，SQS 的 producer 直接送進某個 queue。RabbitMQ 不一樣：producer 把訊息丟給一個 exchange，exchange 再按規則決定送進哪幾個 queue，也可能一個都不送。

queue 要先用一條 binding 綁到 exchange 上，binding 帶著條件。訊息進 exchange 後，比對每條 binding，符合的 queue 就收到一份。producer 只認得 exchange，完全不用知道後面接了幾個 queue、條件是什麼。

## 三種 exchange，三種比對規則

- **fanout**：不看條件，進來的訊息複製給所有綁上來的 queue。要廣播就用它，效果跟 SNS 的一發多收一樣。
- **direct**：訊息帶一個 routing key，binding 也帶一個 key，兩個字串完全相等才送。拿來做精確分流，例如 `severity=error` 的 log 只進 error queue。
- **topic**：routing key 是用點分段的字串（`order.us.paid`），binding 可以用萬用字元比對（`order.*.paid`、`order.#`）。要按模式訂閱一整類事件就用它，這是 RabbitMQ 最有彈性的一種。

## 為什麼這層有用

路由規則寫在 exchange 和 binding 上，不寫在 producer 裡。今天多一個 queue 想收 `order.*.cancelled`，加一條 binding 就好，producer 一行都不用改。這是 RabbitMQ 跟 Kafka、SQS 最不一樣的地方：它把「哪則訊息去哪」變成一層可以隨時改的設定。

---

exchange 是 producer 和 queue 中間的路由層。fanout 全送、direct 比對完整 key、topic 比對模式。訊息進哪些 queue 由 binding 決定，所以 producer 不用認識任何 queue。
