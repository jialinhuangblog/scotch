---
title: "送達保證（三種投遞語義）"
slug: delivery-guarantees
brief: "at-most / at-least / exactly-once 不是系統的類別，是每家都能調的設定：送出要不要等 ack、重送、消費端要不要冪等。"
date: 2026-07-12
article: message-system-axes
---

# 送達保證（三種投遞語義）

> 一則訊息送出去，到底會不會漏、會不會重複？這不是選哪個產品決定的，是設定決定的。

## 三個等級

- **at most once（最多一次）**：送出去就不管，不等 ack。最快，但對方沒收到就沒了，會漏。
- **at least once（至少一次）**：沒收到 ack 就重送，保證不漏，但同一則可能送到兩次以上，會重複。
- **exactly once（恰好一次）**：不漏也不重複。最貴，限制最多。

多數系統實務上停在 at-least-once，靠消費端 [冪等](chunk://idempotency) 把重複吃掉：同一則處理兩次，結果跟一次一樣。效果上接近 exactly-once，不用真的做到「恰好投遞一次」。真正的 [exactly-once](chunk://exactly-once) 只在系統內部（如 Kafka→Kafka 用 transaction）成立，一碰到外部 DB 就退回 at-least-once 配冪等。

## 這是設定，不是身分

同一個 MQTT broker，QoS 每則訊息自己選：

```text
QoS 0  送出不管            → at most once
QoS 1  重送到收到 PUBACK   → at least once（可能重複）
QoS 2  四步握手           → exactly once（最貴）
```

換到別家也一樣可調：RabbitMQ 的 publisher confirm 加 consumer ack 模式、Kafka 的 `acks` 加 offset commit 時機。所以送達保證不拿來定位一個系統屬於哪一類，pub/sub 或 queue 都能配任何一種等級。定位系統看送法、存法、推拉、哪一層；送達保證是選型時另外問的一題。

---

三個等級是漏和重複之間的取捨：不等 ack 會漏，重送會重複，冪等把重複吃掉。哪家都能調，所以它是設定，不是產品的身分。
