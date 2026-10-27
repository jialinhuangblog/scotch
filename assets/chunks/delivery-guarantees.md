---
title: "送達保證（三種投遞語義）"
slug: delivery-guarantees
brief: "at-most / at-least / exactly-once 不是系統的類別，是每家都能調的設定：送出要不要等 ack、重送、消費端要不要冪等。"
date: 2026-07-12
updated: 2026-10-19
revisions: 3
article: message-system-axes
---

# 送達保證（三種投遞語義）

> 一則訊息送出去，到底會不會漏、會不會重複？

## 三個等級

拿同一個情境走三遍。訂單服務要把「訂單 42 出貨了」送給通知服務，通知服務收到就推一則 app 通知給使用者。網路在中間丟了一個封包。

**at most once（最多一次）。** 訂單服務送出去就不管，不等對方回 ack。丟掉的要是訊息本身，通知服務根本沒收到，使用者不會收到通知，這則就漏了。好處是最快，送完馬上做下一件事。

**at least once（至少一次）。** 訂單服務送出後等 ack，一秒沒等到就重送。丟掉的是訊息，重送補回來，不漏。但丟掉的要是 ack，通知服務其實收到了、也推了通知，只是回覆沒送到，訂單服務以為對方沒收到又送一次，使用者就收到兩則一樣的通知。不漏，但會重複。

**exactly once（恰好一次）。** 不漏，而且使用者只收到一則通知。訊息在網路上還是可能送到兩次，所以做法是 at-least-once 再加上收的那邊做 dedup：處理訊息跟記下「這則處理過了」要一起成功或一起不算，重送來的才認得出來並丟掉。最貴，限制最多。

dedup 最常見的做法是消費端的 [冪等](chunk://idempotency)：通知服務用「訂單 42 出貨」這個 key 查一下推過沒有，推過就跳過，第二則就不會發出去。不過「查有沒有推過」、「推通知」、「記下推過了」是分開的三步。推完通知、還沒記下 key 就當機的話，重送來時查不到這個 key，使用者一樣收到兩則。要避免這種重複，「推通知」跟「記下 key」得同時成功或同時不算，可是推播服務在系統外面，兩步沒辦法放進同一個交易。所以這個例子只做到「除了當機那一刻，都不會重複」，還不是 exactly once。真正的 [exactly-once](chunk://exactly-once) 要讓結果跟「處理過了」的紀錄寫在同一個地方，綁進同一個交易。Kafka→Kafka 用 transaction 做得到。結果寫進外部 DB 也做得到：consumer 把結果跟自己讀到的 offset 寫進同一個 DB 交易，重啟時從 DB 讀回 offset，Kafka 的 consumer 文件就是這樣建議的。做不到的是外部 API，像這裡的推播服務沒辦法跟 offset 放進同一個交易，只能退回 at-least-once 配冪等。

## 同一個系統可以調成不同等級

同一個 MQTT broker，QoS 每則訊息自己選：

```text
QoS 0  送出不管            → at most once
QoS 1  重送到收到 PUBACK   → at least once（可能重複）
QoS 2  四步握手           → exactly once（最貴）
```

換到別家也一樣可調：RabbitMQ 的 publisher confirm 加 consumer ack 模式、Kafka 的 `acks` 加 offset commit 時機。所以送達保證不拿來定位一個系統屬於哪一類，pub/sub 或 queue 都能配任何一種等級。定位系統要看的是 [訊息系統選型](article://message-system-axes) 那幾個軸，送達保證是選型時另外問的一題。


三個等級是漏和重複之間的取捨：不等 ack 會漏，重送會重複，冪等把重複消掉，但要連當機那一刻都不重複，處理跟紀錄得在同一個交易裡。
