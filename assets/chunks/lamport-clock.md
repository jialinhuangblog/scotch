---
title: "Lamport Clock"
slug: lamport-clock
brief: "每個節點一個計數器，收到訊息取 max + 1，因果順序反映在數字大小上。"
date: 2026-07-20
---

# Lamport Clock

分散式系統判斷「誰先誰後」不能靠牆上時鐘，因為每台機器的[時鐘不同步](chunk://clocks)。Lamport clock 乾脆不用時間，用遞增的計數器。

規則：每個節點有一個計數器。每次操作 +1，收到別人的訊息時取 max(自己, 對方) + 1。

```text
Node A:  1 → 2 → 3
                    ↘ 送訊息給 B
Node B:        1 → 2 → max(2, 3) + 1 = 4
```

保證：如果 A 發生在 B 之前，A 的計數器一定比 B 小。但反過來不成立：計數器小不代表真的先發生，兩個無關的操作也有大小之分。要分辨兩個事件是有因果關係還是同時發生，得用 [Vector Clock](chunk://vector-clock)。
