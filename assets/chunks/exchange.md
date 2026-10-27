---
title: "RabbitMQ Exchange"
slug: exchange
brief: "producer 不直接寫 queue，先丟給 exchange，exchange 按綁定規則決定這則進哪幾個 queue。"
date: 2026-07-12
updated: 2026-10-17
revisions: 2
article: rabbitmq-routing
---

# RabbitMQ Exchange

> producer 想發一則訊息，但哪些 queue 該收，規則常常在變。要怎麼讓 producer 不用認識這些 queue？

## 中間多一層路由

Kafka 的 producer 直接寫進某個 topic，SQS 的 producer 直接送進某個 queue。RabbitMQ 的 producer 則是把訊息丟給一個 exchange，由 exchange 按規則決定送進哪幾個 queue，也可能一個都不送。

queue 要先用一條 binding 綁到 exchange 上，binding 帶著條件。走一則訊息。exchange 叫 `orders`，型別是 topic，上面掛了三條 binding：

```text
binding 1  order.*.paid       → queue: invoice
binding 2  order.us.#         → queue: us-analytics
binding 3  order.*.cancelled  → queue: refund
```

producer 發一則 routing key 是 `order.us.paid` 的訊息給 `orders`。exchange 逐條比對。binding 1 的 `*` 對上 `us`，符合，invoice 收一份。binding 2 的 `#` 對上 `paid`，符合，us-analytics 也收一份。binding 3 要的是 `cancelled`，不符合。同一則訊息複製成兩份，進了兩個 queue。producer 只認得 `orders` 這個名字，不知道後面有三條 binding，也不知道這則會變成兩份。

## exchange 常用的三種比對規則（第四種 headers 很少用）

- **fanout**：不看條件，進來的訊息複製給所有綁上來的 queue。要廣播就用它，效果跟 SNS 的一發多收一樣。
- **direct**：訊息帶一個 routing key，binding 也帶一個 key，兩個字串完全相等才送。拿來做精確分流，例如 `severity=error` 的 log 只進 error queue。
- **topic**：routing key 是用點分段的字串，binding 可以用萬用字元比對，`*` 對一段、`#` 對零段到多段，上面那個例子就是這種。要按模式訂閱一整類事件就用它，這是 RabbitMQ 最有彈性的一種。

## 為什麼這層有用

路由規則寫在 exchange 和 binding 上，不寫在 producer 裡。明天多一個 queue 想收 `order.*.paid` 做詐欺偵測，加第四條 binding 就好，producer 一行都不用改，下一則 `order.us.paid` 就變成三份。
