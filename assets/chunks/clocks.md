---
title: "Clocks"
slug: clocks
brief: "分散式的時間問題：實體時鐘不可靠，所以有邏輯時鐘，再有混合時鐘做折衷。"
date: 2026-03-16
updated: 2026-07-20
revisions: 1
---

# Clocks

> 分散式系統裡的時間問題。判斷「誰先誰後」比想像中難得多。

## 牆上時鐘不可靠

每台機器有自己的時鐘。問題：兩台機器的時鐘不會完全同步。

```text
Machine A 的時鐘：12:00:00.000
Machine B 的時鐘：12:00:00.150   ← 快了 150ms
```

A 在 12:00:00.000 寫入 x=1，B 在 12:00:00.100 寫入 x=2。用牆上時鐘判斷，B 的 timestamp 更大（因為 B 的時鐘快了），B 贏。但實際上 B 的寫入發生在 A 之後 100ms，A 才應該先。

NTP（Network Time Protocol）可以同步時鐘，但精度只到幾毫秒到幾十毫秒。對於每秒幾萬筆寫入的系統，這個誤差足以搞混順序。

## Logical Clock（邏輯時鐘）

不用牆上時間，用遞增的計數器。[Lamport clock](chunk://lamport-clock) 讓因果順序反映在計數器大小上；[vector clock](chunk://vector-clock) 再進一步，分辨兩個事件是有因果關係還是 concurrent。各自拆成獨立 chunk。

## Hybrid Logical Clock（HLC）

CockroachDB、TiDB 用的折衷方案。結合牆上時鐘和邏輯計數器：

```text
HLC = (physical_time, logical_counter)

比較規則：先比 physical_time，相同再比 logical_counter
```

大部分時候用牆上時鐘（精度夠），牆上時鐘相同時用邏輯計數器打破平手。兼顧效率和正確性。

## Google TrueTime

Google Spanner 的做法更極端。用 GPS 和原子鐘確保所有 data center 的時鐘誤差在幾毫秒內。API 回傳的不是一個時間點而是一個區間 `[earliest, latest]`。如果兩個操作的區間不重疊，就能確定先後順序。

只有 Google 做得到，因為需要在每個 data center 裝 GPS 接收器和原子鐘。

---

分散式系統裡「誰先誰後」不是看牆上時鐘，因為時鐘不同步。Lamport clock 管因果順序，vector clock 看兩件事是不是同時發生，HLC 則是實務上的折衷。
