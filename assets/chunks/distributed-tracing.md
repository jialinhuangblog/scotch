---
title: "Distributed Tracing"
slug: distributed-tracing
brief: "每個 request 發一個 trace ID，經過的 service 都用它記 span，事後串回完整路徑。"
date: 2026-06-12
---

# Distributed Tracing

> 一個請求經過十個 microservice，慢在哪一個？怎麼看得出來？

## 跟著一個請求走遍所有 service

distributed tracing 追蹤**單一請求**穿過所有 service 的完整路徑。每個請求發一個 trace ID，每經過一個服務、每做一次操作就記一個 span，所有 span 依呼叫關係組成樹狀結構，從中看得出這個請求依序走了哪些服務、各花多久。Jaeger、Zipkin、OpenTelemetry 是代表。

trace ID 透過 header 一路傳給下游（context propagation），每個服務都用同一個 id 記 span，最後才串得回同一個請求。

像包裹的追蹤號碼：一個包裹在每個分撿中心刷一次，攤開來看就知道它卡在哪一站。

## 補上 metric 跟 log 的盲區

[metric](chunk://metrics) 顯示「p99 變慢了」，[log](chunk://logging) 記錄「這個服務報錯」，但「一個慢請求到底卡在十個服務的哪一段」只有 trace 答得出來。實務上三個搭配使用。metric 發現問題，trace 找出是哪一段，log 再看那一段的細節。
