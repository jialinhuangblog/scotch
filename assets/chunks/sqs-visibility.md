---
title: "SQS Visibility Timeout"
slug: sqs-visibility
brief: "訊息被撈走後不是馬上刪，而是先隱形一段時間。處理完才刪，沒刪就重新現身換別人。"
date: 2026-07-12
article: sns-sqs
---

# SQS Visibility Timeout

> 一個 queue、三台 worker 一起撈，怎麼保證一則訊息只被一台處理，而且處理到一半掛了不會就這樣消失？

## 撈走不等於刪掉

SQS 的訊息不是被讀到就刪。一台 worker 撈走一則後，這則進入一段「隱形時間」（visibility timeout，預設 30 秒）：在這段時間內，別台 worker 看不到它，不會重複撈。

worker 處理完，明確送一個 delete 回 queue，這則才真的消失。要是 worker 中途當掉、沒送 delete，時間一到訊息重新現身，換別台接手。

```text
worker A 撈走 #42  ──►  #42 隱形（timeout 內別人看不到）
   ├─ 處理完，送 delete  ──►  #42 刪除，結束
   └─ 處理到一半掛了，沒 delete  ──►  timeout 到，#42 重新現身，worker B 撈到
```

## 這帶來 at-least-once

隱形加超時重現，換到的是「訊息不會因為 worker 掛掉而消失」。代價是同一則可能被處理超過一次：worker 處理完、delete 還沒送到就掛了，這則超時後會被再撈一次。

所以 SQS 是 at-least-once，不是 exactly-once。消費端要能處理重複，一般靠 [冪等](chunk://idempotency)：同一則處理兩次，結果跟一次一樣。

## timeout 設多久

設太短，worker 還在處理訊息就重新現身，別台重複做白工。設太長，worker 真的掛了，那則要等很久才被別人接手。抓法是設成「處理一則最壞要多久」再留點餘裕；處理時間變動大的，可以在處理中途延長單則的 timeout。

---

visibility timeout 是 SQS 分工的核心：撈走先隱形、處理完才刪、沒刪就重現。它保證一則同時只給一台，也保證掛掉的工作有人補，代價是消費端得自己處理重複。
