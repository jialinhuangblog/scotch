---
title: "Dead-Letter Queue"
slug: dlq
brief: "一則訊息重試幾次都失敗，就移進另一個專門的 queue 隔離，別讓它一直卡住後面的。"
date: 2026-07-12
article: sns-sqs
---

# Dead-Letter Queue

> 有一則訊息每次處理都失敗、又被重新撈到、又失敗，一直佔著位置。怎麼讓它別卡住整條 queue？

## 壞訊息會反覆重試

在 [visibility timeout](chunk://sqs-visibility) 的機制下，處理失敗、沒 delete 的訊息會超時重現，被再撈一次。正常訊息這樣沒問題，重試一兩次就過了。但如果一則訊息本身壞了（格式錯、對應的資料被刪、程式碰到它就丟例外），它每次都失敗、每次都重現，變成無限重試，一直卡在最前面。

## DLQ 把它移走

dead-letter queue 是另一個獨立的 queue，專門收這種訊息。設一個重試上限（maxReceiveCount，比如 5），SQS 幫每則記被撈過幾次；同一則被撈超過 5 次還沒成功，就自動把它從主 queue 搬進 DLQ。

```text
主 queue：#42 撈了 5 次都失敗
   └─►  超過 maxReceiveCount，#42 移進 DLQ，主 queue 恢復流動
DLQ：#42 留著等人來看
```

主 queue 少了這顆絆腳石，正常訊息繼續流。那則壞訊息不丟掉，留在 DLQ 裡，之後接個告警、人工撈出來查是什麼原因。

## DLQ 也是一種解耦

處理失敗這件事，本來會回頭影響主 queue 和後面所有訊息。DLQ 把失敗的隔到一邊，讓一則壞訊息的問題不擴散到整條線。所以它常跟 [SNS+SQS](article://sns-sqs) 一起設，補上失敗隔離這一塊。

---

DLQ 用一個重試上限，把反覆失敗的訊息搬去隔離，主 queue 保持流動，壞訊息留著事後查。SQS、[RabbitMQ](chunk://message-queue-comparison) 都內建這個機制。
