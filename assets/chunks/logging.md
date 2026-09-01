---
title: "Logging"
slug: logging
brief: "結構化 log。Correlation ID。出事時你第一個看的東西。"
date: 2026-06-12
---

# Logging

> 線上出事了，你第一個會想翻什麼？

## 一件件帶時間的具體事件

log 是把發生的事，帶時間戳一筆筆記下來。Observability 三本柱（log、metric、trace）裡，log 顆粒度最細：它記「在這個時間點，這件具體的事發生了」。

**結構化 log**（輸出 JSON 而不是純文字）讓機器能 query：`level=error AND user_id=123`。再配上每個請求一個 correlation ID（同一個請求穿過所有 service 都帶同一個 id），出事時能把散在各台機器的相關 log 串回同一條線。

通常會集中收（送進 ELK、Loki）統一查，而不是登進每台機器各看各的。

像一本日記：每件事按時間寫下來。問「下午 3:42 到底發生什麼」很強；問「這個月的趨勢」就不是它的事，那是 metric。

## 代價

量大、貴。每筆請求都記，量會非常大，要分級（debug / info / warn / error）只留必要的，還要設保留期。

---

log 記下一件件帶時間的具體事件，結構化 + correlation ID 讓你出事時查得到、串得起來。細到能還原單一請求，代價是量大要分級跟設保留。
