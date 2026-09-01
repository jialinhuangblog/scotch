---
title: "Distributed Tracing"
slug: distributed-tracing
brief: "一個 request，十個 service。Trace ID 跟著它走到底。"
date: 2026-06-12
---

# Distributed Tracing

> 一個請求經過十個 microservice，慢在哪一個？怎麼看得出來？

## 跟著一個請求走遍所有 service

distributed tracing 追蹤**單一請求**穿過所有 service 的完整路徑。每個請求發一個 trace ID，每經過一個服務、做一件事就記一個 span，所有 span 拼成一棵樹，看得出這個請求依序走了哪些服務、各花多久。Jaeger、Zipkin、OpenTelemetry 是代表。

trace ID 透過 header 一路傳給下游（context propagation），每個服務都用同一個 id 記 span，最後才串得回同一個請求。

像包裹的追蹤號碼：一個包裹在每個分撿中心刷一次，攤開來看就知道它卡在哪一站。

## 補上 metric 跟 log 的盲區

[metric](chunk://metrics) 說「p99 變慢了」，[log](chunk://logging) 說「這個服務報錯」，但「一個慢請求到底卡在十個服務的哪一段」只有 trace 看得到。三個合起來才完整：metric 發現問題、trace 定位是哪一段、log 看那一段的細節。

---

distributed tracing 用 trace ID 跟著一個請求走遍所有 service，把每段耗時拼成一棵樹，專門回答「這個請求慢在、錯在哪一個服務」。
