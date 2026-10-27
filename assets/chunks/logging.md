---
title: "Logging"
slug: logging
brief: "結構化 log 加上 correlation ID，出事時第一個會去翻的紀錄。"
date: 2026-06-12
updated: 2026-10-18
revisions: 2
---

# Logging

> 線上出事了，第一個會去翻什麼呢？

## 一件件帶時間的具體事件

log 是把發生的事，帶時間戳一筆筆記下來。Observability 三大支柱（log、metric、trace）裡，log 顆粒度最細，它記的是「在這個時間點，這件具體的事發生了」。

拿一個下單失敗走一遍。使用者 123 下午 3:42 按下結帳，收到 500。這個請求經過 API gateway、訂單服務、庫存服務，每個服務各有 20 台機器，總共 60 台，出事那一筆落在哪三台沒人知道。

純文字 log 長這樣：`2026-10-17 15:42:07 ERROR insufficient stock for sku 889`。log 留在 60 台機器上的話，不管什麼格式，都得一台一台登進去 grep，所以要先集中收，送進 ELK 或 Loki 統一查。集中之後，純文字 log 只能拿 `insufficient stock` 這串字去比對每一行，比對出來的是那段時間所有缺貨的錯誤，而這行裡沒有 user_id，分不出哪一筆是使用者 123 的。結構化 log 改成輸出 JSON：`{"ts":"15:42:07","level":"error","service":"inventory","user_id":123,"request_id":"a1b2c3","msg":"insufficient stock"}`。每個欄位都能當查詢條件，`level=error AND user_id=123` 一行就找到這筆。

request_id 那個欄位叫 correlation ID。API gateway 收到請求時產生一個 `a1b2c3`，放進 header 往下傳，訂單服務、庫存服務寫 log 時都帶同一個。查 `request_id=a1b2c3`，三個服務各自那幾行就串成一條：gateway 15:42:06 收到、訂單服務 15:42:06 建單、庫存服務 15:42:07 扣庫存失敗。只用 `user_id=123` 加上這兩秒的時間範圍也能串成一條，前提是這兩秒裡 123 只送了一個請求。他要是連按兩次結帳，gateway 跟訂單服務各有兩行 `user_id=123`、時間都是 15:42:06，分不出哪一行屬於失敗的那一筆。request_id 每個請求各一個，不會重複，查 `request_id=a1b2c3` 只會拉出失敗那一筆的三行。

像一本日記，每件事按時間寫下來。問「下午 3:42 到底發生什麼」很好用，問「這個月的趨勢」就要看 metric。

## 代價

每筆請求都記的話，量會非常大，儲存也貴。所以要分級（debug / info / warn / error）只留必要的，還要設保留期。
