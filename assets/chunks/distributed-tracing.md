---
title: "Distributed Tracing"
slug: distributed-tracing
brief: "每個 request 發一個 trace ID，經過的 service 都用它記 span，事後串回完整路徑。"
date: 2026-06-12
updated: 2026-10-18
revisions: 2
---

# Distributed Tracing

> 一個請求經過十個 microservice，慢在哪一個？怎麼看得出來？

## 跟著一個請求走遍所有 service

使用者按下結帳，請求進到 gateway。gateway 產生一個隨機的 trace ID，假設是 `7f3a`，再替自己這一段產生一個 span ID，假設是 `g1`，兩個一起寫進 HTTP header `traceparent`，往下呼叫訂單服務。訂單服務從 header 讀到 `7f3a` 跟 `g1`，知道自己是 `g1` 呼叫的，再替自己產生 span ID `o2`。它呼叫庫存服務跟付款服務時，header 裡放的是同一個 `7f3a` 加上自己的 `o2`。所以 trace ID 一路不變，span ID 每一跳換成呼叫者的那一個。這樣一路傳下去，這個請求碰到的每個服務手上都有 `7f3a`，也都知道上一層是誰，這段叫 context propagation。

每個服務處理這個請求的時候，記一筆 span，內容是 trace ID、自己的 span ID、呼叫者的 span ID（parent）、自己的名字、開始時間、結束時間。庫存服務那筆是 `7f3a`、自己的 ID、parent `o2`。做完就把 span 送到後端收集，Jaeger、Zipkin 是代表。OpenTelemetry 是另一層東西，它提供各語言的 SDK 跟 Collector，負責產生 span、把 span 送到後端，本身不存資料，也沒有查詢介面。

事後拿 `7f3a` 去查，後端把所有帶這個 trace ID 的 span 撈出來，照 parent 排成上下層（inventory 跟 payment 的 parent 都是 `o2`，所以兩個都排在 order 底下），再照時間畫出來：

```text
gateway          |████████████████████████████████████████| 1200ms
  order          |  ██████████████████████████████████████| 1150ms
    inventory    |    ████                                |   80ms
    payment      |        ████████████████████████████████| 1020ms
```

訂單服務總共花 1150ms，其中庫存 80ms、付款 1020ms，慢的是付款。沒有 trace 的話，只知道結帳要 1.2 秒，十個服務要一個一個去翻各自的 log。

像包裹的追蹤號碼：一個包裹在每個分揀中心刷一次，攤開來看就知道它卡在哪一站。

## 補上 metric 跟 log 的盲區

[metric](chunk://metrics) 顯示「結帳的 p99 從 300ms 變成 1200ms」，[log](chunk://logging) 記錄「付款服務報了一個 timeout」，但「這一個慢請求到底卡在十個服務的哪一段」只有 trace 答得出來。實務上三個搭配使用：metric 發現問題，trace 找出是哪一段，log 再看那一段的細節。

代價是每個服務都要接 SDK、每個請求都要多送 span，流量大的系統會只抽樣記錄，例如每一百個請求記一個。
