---
title: "Vector Clock"
slug: vector-clock
brief: "每個節點維護全體節點的計數器向量，能分辨因果關係和 concurrent。"
date: 2026-07-20
---

# Vector Clock

[Lamport clock](chunk://lamport-clock) 只保證單方向：有因果關係的事件，計數器一定有大小之分；計數器有大小，卻不代表有因果關係。Vector clock 補的就是這個缺口。每個節點維護一個向量，記錄所有節點的計數器，能判斷兩個事件是「有因果關係」還是「同時發生（concurrent）」。

```text
Node A: [A:2, B:1]   ← A 做了 2 次，知道 B 做了 1 次
Node B: [A:1, B:3]   ← B 做了 3 次，知道 A 做了 1 次

兩個向量互相不包含 → concurrent → 需要衝突解決
```

比較規則：A 的向量每一格都 ≤ B 的向量，A 就發生在 B 之前；互相不包含，就是 concurrent。

DynamoDB 曾經用 vector clock，後來簡化成 last-write-wins（用牆上時鐘）。代價在向量本身：節點越多向量越長，每筆資料都要帶著它。
