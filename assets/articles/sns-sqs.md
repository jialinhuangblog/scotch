---
title: "一個發通知，為什麼要拆成 SNS 加 SQS 兩個東西"
slug: sns-sqs
date: 2026-07-12
subtitle: "SNS 和 SQS 都不留訊息，跟 Kafka 相反。這篇看它們合起來，為什麼能把生產者和消費者解耦。"
chapter: "messaging"
tags: [sqs, sns, aws, decoupling, dlq, system-design]
related: [message-system-axes, why-kafka, rabbitmq-routing, queue-peak-shaving, url-shortener-demo]
---

# 一個發通知，為什麼要拆成 SNS 加 SQS 兩個東西

一筆訂單成立，付款、庫存、寄信三個服務都要知道。在 AWS 上這件事的標準做法是 SNS 加 SQS：SNS 負責發，SQS 負責收，中間還多一層。明明一個廣播就講完的事，為什麼要兩個東西？

它們在四個問題上的位置（[四題是哪四題](article://message-system-axes)）：SNS 是 pub/sub、推、後端；SQS 是 point-to-point、拉、後端。存法上兩個都是 ack 完就刪，跟 [Kafka 的「留」](article://why-kafka)正好相反。所以這篇不講 replay，它們故意不留。問題在別處：兩個都會刪的東西，為什麼要湊成一對用。

答案是解耦。發訊息的不用知道誰在收、收得完收不完、有沒有掛。下面拆開看，這個解耦為什麼需要兩個東西才成立。

---

## 為什麼不 SNS 直接推給服務

SNS 自己就能推。它可以直接把訊息 POST 到一個 HTTP endpoint，付款服務掛個網址上去就收得到。那為什麼中間還要塞一個 SQS？

因為 SNS 推完不管。它把訊息送出去那一刻就當作結束，訊息不留（存法=刪，發完即丟，跟 [pub/sub 的定義](chunk://message-queue-comparison)一致）。付款服務那時候剛好在重啟，這則就沒了。或者黑五流量灌進來，SNS 一秒推三千則，服務一秒處理不了三千則，就這樣當掉。

中間塞一個 SQS 就解掉這兩件事。SNS 發一份，複製進每個服務各自的 SQS queue；服務從自己的 queue 慢慢撈，撈一則處理一則。服務掛了，訊息在 queue 裡等它回來；流量暴衝，queue 幫忙頂著，服務按自己的速度消化（這就是 [削峰](article://queue-peak-shaving)）。

所以 SNS 負責廣播，SQS 負責緩衝。發的人只對 SNS 講一句，收的人各自顧自己的 queue，兩邊誰都不用認識對方，這就是解耦。

```bash
# SNS 發一次，訂閱的每個 SQS queue 各收一份
aws sns publish --topic-arn arn:aws:sns:...:orders --message '{"orderId":123}'

# 每個服務 poll 自己的 queue，處理完才刪
aws sqs receive-message --queue-url https://sqs.../billing-queue
aws sqs delete-message  --queue-url https://sqs.../billing-queue --receipt-handle <handle>
```

---

## 一個 queue，多個 worker 搶

付款服務單台處理不完，開三台一起撈同一個 queue，這叫 competing consumers：一則訊息只會被其中一台拿到，三台把工作分掉。

「一則只給一台」這件事，[Kafka 的 consumer group](chunk://consumer-groups) 內部也一樣做：同一個 group 裡的 consumer 互相分，一則只給一台。這一層兩邊相同，別把它當成差異。

差別在另一層：怎麼讓「第二個下游」也拿到完整一份。Kafka 開一個新 consumer group 就好，同一份 log 從頭再讀一遍；SQS 一個 queue 就是一個終點，要讓第二個下游拿到全部，得靠 SNS 再 fan-out 出第二個 queue。所以 queue 的數量對應「幾個下游服務」，一個 queue 底下的 worker 數量對應「這個服務要幾台分攤流量」，是兩件事。

分工靠的是 [visibility timeout](chunk://sqs-visibility)。一台 worker 撈走訊息後，這則不是馬上刪，而是暫時隱形一段時間，別台看不到、不會重複拿。處理完，worker 明確叫 queue 刪掉；要是 worker 中途掛了沒刪，超時後訊息重新現身，換別台接手。

代價是這套只保證 at-least-once：worker 處理完、還沒來得及刪就掛了，訊息超時後會被再撈一次。所以消費端要能處理重複，通常靠 [冪等](chunk://idempotency)。

---

## 一直失敗的那則訊息怎麼辦

有一則訊息格式壞了，worker 每次撈到都處理失敗、沒刪，超時後又現身，再被撈到、再失敗。這則毒訊息會一直佔著位置反覆重試，卡住後面正常的訊息。

解法是 [dead-letter queue（DLQ）](chunk://dlq)。設定重試上限，比如同一則失敗五次，SQS 就把它移進另一個專門的 queue 隔離起來，主 queue 恢復流動。那則壞訊息留在 DLQ 裡，之後人工撈出來看是什麼問題。

DLQ 是解耦的延伸：連處理失敗都不讓它回頭影響上游和其他訊息。

---

## 都刪，所以補不了歷史

繞回存法。SQS 訊息被 ack 就刪，這帶來一個 Kafka 沒有的限制：一個新服務今天上線，想要過去三個月的訂單事件，撈不到，那些訊息在被處理掉的當下就沒了。

這正是 [why-kafka](article://why-kafka) 那篇取捨的另一面。Kafka 留著，所以能 replay、能讓新下游補歷史，代價是 retention、offset、順序全要自己管。SNS+SQS 刪掉，這些全不用管，AWS 全託管，開箱就有 DLQ 和自動重試，代價就是給不了 replay。

---

## 什麼時候用這組

需求是「一件事發生，通知幾個服務各自去做，做完就算」，要解耦、要削峰、要失敗隔離，但不需要重讀、不需要新下游補歷史，那 SNS+SQS 是最省的選擇，全託管、不養 broker。

反過來，只要開始需要 replay、需要同一份資料被多個下游從頭各讀一遍，那是 [Kafka 的「留」](article://why-kafka)在解的問題，SNS+SQS 補不上。
