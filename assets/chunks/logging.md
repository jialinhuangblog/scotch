---
title: "Logging"
slug: logging
brief: "結構化 log 加上 correlation ID，出事時第一個會去翻的紀錄。"
date: 2026-06-12
---

# Logging

> 線上出事了，第一個會去翻什麼呢？

## 一件件帶時間的具體事件

log 是把發生的事，帶時間戳一筆筆記下來。Observability 三大支柱（log、metric、trace）裡，log 顆粒度最細：它記「在這個時間點，這件具體的事發生了」。

**結構化 log**（輸出 JSON 而不是純文字）讓機器能 query：`level=error AND user_id=123`。再配上每個請求一個 correlation ID（同一個請求穿過所有 service 都帶同一個 id），出事時能把散在各台機器的相關 log 串回同一個請求。

通常會集中收（送進 ELK、Loki）統一查，而不是登進每台機器各看各的。

像一本日記：每件事按時間寫下來。問「下午 3:42 到底發生什麼」很好用，問「這個月的趨勢」就要看 metric。

## 代價

每筆請求都記的話，量會非常大，儲存也貴，所以要分級（debug / info / warn / error）只留必要的，還要設保留期。
