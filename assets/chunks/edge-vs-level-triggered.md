---
title: "Edge vs Level Triggered"
slug: edge-vs-level-triggered
brief: "Edge 抓跳變的當下，level 讀當前準位；差別在漏掉一次之後還救不救得回來。"
date: 2026-07-20
---

# Edge-triggered vs Level-triggered

這兩個詞來自數位電路。一條線上的電壓在低（0）跟高（1）之間跳，畫成方波：

```
        ┌────────┐        ┌────
        │        │        │
────────┘        └────────┘
        ↑        ↑
     上升緣    下降緣
```

Level（準位）是訊號現在停在哪，高還是低。Edge（邊緣）是訊號跳變的當下，從低到高或從高到低。同一條線，兩種讀法：問「它現在是高的嗎」是 level，問「它剛剛有沒有跳上去」是 edge。

硬體對訊號反應也就分兩派。Level-triggered 只要訊號維持在某準位就持續反應。Edge-triggered 只在跳變的當下反應一次，之後訊號維持多久都不再動，直到下次跳變。

差別在「漏掉」會怎樣。Edge 是一次性的，那個瞬間沒抓到就永遠沒了。Level 沒這問題，這次沒看下次再看，只要準位還在就讀得到。你摸過的例子：`addEventListener('click')` 是 edge（發生那刻觸發一次），CSS `:hover` 是 level（滑鼠停留期間持續成立）。

搬到 k8s 就通了。Edge-triggered 的 controller 訂閱「Pod 掛了」這個事件，收到才反應；controller 當時當機或訊息丟了，那個邊緣就錯過，Pod 一直躺著沒人管。k8s 選 level-triggered：每輪 [reconciliation](chunk://reconciliation) loop 去讀當前狀態，拿 desired 比對 actual。它問的是「現在實際有幾個 Pod」，不是「剛剛發生了什麼」，所以漏掉任何一次觀察都無所謂，下一輪重讀整體狀態自然補上。

代價是 controller 每輪都要讀狀態、做比對，比等事件通知費工。但分散式系統裡訊息一定會丟，拿效率換「漏了也能自我修復」划算。Kubernetes 看的是現在的狀態，不是剛剛發生過什麼。
