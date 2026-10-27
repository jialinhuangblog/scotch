---
title: "The Log"
slug: the-log
brief: "只能追加、有序、不可變。"
date: 2026-03-09
updated: 2026-10-18
revisions: 2
---

# The Log

把 Kafka 想成一份 log 而不是 queue。

先講 log 長什麼樣。它就是磁碟上一個檔案，新資料只能加在尾端，加進去的每一筆拿到一個位置編號，從 0 開始數。寫進去的東西不會改、不會插隊，也不會因為有人讀過就消失。五筆訊息進來，檔案就是 [0] [1] [2] [3] [4]，誰來讀都看到同樣這五筆、同樣這個順序。

這是一個 partition 的情況。Kafka 的 topic 通常分成好幾個 partition，每個 partition 是各自的一份 log，編號也各自從 0 開始。一個三 partition 的 topic 收到五筆，可能是 P0 拿到兩筆、P1 拿到兩筆、P2 拿到一筆，consumer 讀到的先後就不一定是寫進來的先後，因為順序只在同一個 partition 裡成立。要讓同一張訂單的訊息照順序讀，就讓它們帶同一個 key，同一個 key 會寫進同一個 partition。

## 跟 RabbitMQ 最大的差別

RabbitMQ 是 queue：consumer 拿走一筆、回 ack，server 就把那筆刪掉，而且是 server 自己記著誰拿過什麼。

Kafka 不刪。訊息留在 log 裡（留多久看 retention 設定），server 也不記每一筆被誰拿過，只替每個 consumer group 在每個 partition 上存一個數字，叫 offset，就是「讀到第幾筆了」。這個數字由 consumer 往前推：處理完一段，consumer 把新的 offset commit 給 broker，broker 寫進一個內部 topic `__consumer_offsets`，等所有副本都收到才回成功。

## Offset

```
Log:  [0] [1] [2] [3] [4]
               ↑
Consumer A offset: 2
```

Consumer A 處理完 0 和 1，把 offset 2 commit 給 broker。這時它掛了，重啟回來向 broker 要回這個 2，從 [2] 繼續讀，一筆都不少。要是 A 處理完 [2]、還沒 commit 就掛了，broker 那邊還是 2，重啟後會從 [2] 開始，[2] 就被處理了兩次。要是想重算過去一個月的資料，把 offset 改回 0 就能從頭讀一遍，log 本來就還在。

兩個服務讀同一份 log，各記各的 offset。A 讀到 2，新上線的 B 從 0 開始補讀過去的資料，兩邊互不影響，server 也不用替任何一邊留副本。

## 為什麼叫 log？

跟資料庫的 WAL（Write-Ahead Log）、Raft 的 consensus log 是同一個概念：append-only、有序、不可變。差別是 WAL 跟 Raft log 都藏在系統內部，Kafka 直接把 log 開放給 consumer 讀。
