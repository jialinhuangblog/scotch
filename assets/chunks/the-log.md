---
title: "The Log"
slug: the-log
brief: "只能追加、有序、不可變。其他一切都建在這上面。"
date: 2026-03-09
---

# The Log

把 Kafka 想成一份 log 而不是 queue，只能 append、有順序、會保留。

## 跟 RabbitMQ 最大的差別

RabbitMQ 送完就刪，server 記錄誰消費了什麼。

Kafka 保留 log，consumer 自己記 offset。想重播就從任意位置讀。新服務上線可以補讀過去的資料。

## Offset

```
Log:  [0] [1] [2] [3] [4]
               ↑
Consumer A offset: 2
```

consumer 重啟後從 offset 2 繼續，一筆都不會少。兩個不同服務可以讀同一份 log，各自有獨立進度。

## 為什麼叫 log？

跟資料庫的 WAL、Raft 的 consensus log 是同一個概念：append-only、有序、不可變。Kafka 把這個內部機制變成了產品本身。
