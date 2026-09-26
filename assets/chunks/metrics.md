---
title: "Metrics"
slug: metrics
brief: "Counter、gauge、histogram。Prometheus 拉、StatsD 推。"
date: 2026-06-12
---

# Metrics

> 想在 dashboard 上看「現在 QPS 多少、p99 延遲多少」，要從 log 一筆一筆撈嗎？

## 隨時間聚合的數字

metric 不像 log 記每一件事，它記「這段時間的量」，是聚合過的數字：

- **counter**：只增不減的累計數，像總請求數。
- **gauge**：當下的值，像記憶體用量、線上人數。
- **histogram**：分布，像延遲落在各區間各幾筆（算 p99 靠它）。

因為是聚合的，存起來很便宜，適合畫 dashboard、設告警、看趨勢。常盯的四個黃金訊號：latency、traffic、errors、saturation。

Prometheus 主動去各服務「拉」（pull）資料，StatsD 則由服務主動「推」（push）。

像汽車儀表板：時速、油量、水溫一眼看完現在狀態，但說不出這趟路是怎麼開過來的。

## 限制

metric 能說出「**有**地方不對」（error rate 飆高），但說不出是「**哪一筆**請求」出事。那要查 [log](chunk://logging) 跟 [trace](chunk://distributed-tracing)。
