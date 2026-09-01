---
title: "Partitions"
slug: partitions
brief: "topic 切成多個 partition，分的是訊息落在哪一段，不是把單一訊息切開。"
date: 2026-06-12
updated: 2026-06-13
revisions: 1
---

# Partitions

> 一個 topic 的訊息量大到一台機器吃不下，怎麼分散又不打亂順序？

## 一個 topic 切成多個 partition

Kafka 的 topic 不是一條 log，是切成好幾段平行的 log，每段叫一個 partition。每個 partition 自己是一條 append-only、用 offset 編號的有序 log。

訊息進來時，producer 決定丟哪個 partition：給了 key 就用 `hash(key) % partition 數`，沒給就輪流放。同一個 key 永遠落在同一個 partition。

要注意被切開的是「訊息落在哪一段」，不是單獨一則訊息。每則訊息（一筆訂單、一個事件）都是完整的一筆，partition 只決定它分到哪一堆。所以 consumer 分著讀，讀到的是不同的整筆訊息，不是同一筆的片段。

像超市結帳：一個收銀台（單 partition）會排很久，開十個收銀台（十個 partition）就能同時結十個人。但你跟你的購物車一定走同一個收銀台（同 key 同 partition），不會被拆開。

整個關係長這樣：一個 topic 切成多個 partition，每個 [consumer group](chunk://consumer-groups) 各自把這些 partition 分給組內的 consumer。

```text
Topic「orders」切成 4 個 partition（每個 partition 自己是一條有序的 log）

  partition 0: [ m0  m4  m8  ... ]
  partition 1: [ m1  m5  m9  ... ]
  partition 2: [ m2  m6  ...     ]
  partition 3: [ m3  m7  ...     ]

同一個 topic 可以被多個 consumer group 各自讀，彼此不影響：

  group「billing」                     group「analytics」
  （組內分工，一個 partition 只給一人）   （跟 billing 各記各的 offset）
    consumer A ← partition 0, 1           consumer X ← partition 0, 1, 2, 3
    consumer B ← partition 2, 3
```

同一個 group 裡，partition 在 consumer 之間分掉，沒有人重複讀；換一個 group，同一批 partition 又能從頭再讀一遍。

## partition 同時管順序跟平行

**順序**：同一個 partition 內嚴格有序，跨 partition 沒有全域順序。要保證某一組訊息的先後（例如同一個 user 的事件），就用同一個 key 讓它們進同一個 partition。

**平行度**：一個 [consumer group](chunk://consumer-groups) 裡，每個 partition 同時只給一個 consumer 讀。所以 consumer 再多，能一起讀的數量也卡在 partition 數。10 個 partition 最多 10 個 consumer 同時讀，第 11 個只能閒著。

## 代價

partition 數量不好改。加 partition 會改變 `hash(key) % N` 的對應，同一個 key 之後落到別的 partition，原本的順序保證就斷了。所以一開始就要估夠。

太多 partition 也有成本：每個 partition 是一組檔案，broker 要開更多 file handle，rebalance 跟 end-to-end 延遲都變高。

---

partition 同時管平行跟順序。同 key 都走同一個 partition 所以順序不亂，consumer 最多能開幾個一起讀，也看 partition 有幾個。
