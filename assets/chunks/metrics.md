---
title: "Metrics"
slug: metrics
brief: "Counter、gauge、histogram。Prometheus 拉、StatsD 推。"
date: 2026-06-12
updated: 2026-10-18
revisions: 2
---

# Metrics

> 想在 dashboard 上看「現在 QPS 多少、p99 延遲多少」，要從 log 一筆一筆撈嗎？

## 隨時間聚合的數字

metric 不像 log 記每一件事，它記的是一個數字，放在服務的記憶體裡，隨著事件更新。

走一遍 Prometheus 的做法。訂單服務有 100 台，每台在記憶體裡放一個計數器 `http_requests_total`，每處理一個請求就加一。Prometheus 每 15 秒去每一台的 `/metrics` 拉一次，拿到的是當下的累計值，像第 0 秒是 48,200、第 15 秒是 49,700。兩次相減除以 15，這台這段時間平均每秒 100 個請求。100 台加起來就是 dashboard 上的 QPS。整個過程 Prometheus 存的是每台每 15 秒一個數字，不是 1,500 筆請求各一行。

三種常見的 metric 型別，差在這個數字怎麼動：

- **counter**：只增不減的累計數，上面的 `http_requests_total` 就是。服務重啟會歸零，Prometheus 看到數字變小就知道是重啟。
- **gauge**：當下的值，可增可減，像記憶體用量 1.2GB、線上人數 3,400。
- **histogram**：把每個請求的延遲丟進預先切好的桶，像 `≤100ms` 的有 1,400 個、`≤500ms` 的有 1,480 個、`≤1s` 的有 1,500 個。1,500 筆的第 99% 是第 1,485 筆，落在 500ms 到 1s 那個桶，所以 p99 大約在這個區間。

因為是聚合的，存起來很便宜，適合畫 dashboard、設告警、看趨勢。常盯的四個黃金訊號：latency、traffic、errors、saturation。

Prometheus 主動去各服務「拉」（pull），StatsD 則由服務主動「推」（push），每個事件送一個 UDP 封包給 StatsD，由它聚合。

像汽車儀表板，時速、油量、水溫一眼看完現在狀態，但說不出這趟路是怎麼開過來的。

## 限制

上面那組桶算出的 p99 落在 500ms 到 1s。假設下午 3:42 起，超過 1s 的請求變多，p99 移到 1s 以上那一桶，metric 只能說「**有**地方不對」，說不出是哪一筆請求、卡在哪個服務。那要查 [log](chunk://logging) 跟 [trace](chunk://distributed-tracing)。
