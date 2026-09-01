---
title: "partition 就是 offset 嗎"
slug: kafka-partitions-groups
date: 2026-07-12
subtitle: "log 會被切碎嗎、一條 partition 幾台在讀、為什麼換個 group 又能從頭讀。這批問題其實是同一件事：Kafka 在順序和平行之間怎麼分。"
chapter: "messaging"
tags: [kafka, partition, offset, consumer-group, ordering, system-design]
related: [why-kafka, message-system-axes]
---

# partition 就是 offset 嗎

[why-kafka](article://why-kafka) 講 Kafka 為什麼值得養：訊息留著。這篇講它怎麼被讀：log 是一整條嗎？多台 consumer 一起讀，是把 log 切碎嗎？切了順序怎麼辦？partition 跟 offset 又是什麼關係？照順序走一遍，每一步配實際的資料。

---

## 先假設 Kafka 只有一條 log

三筆訂單（42、77、91）的事件照發生時間進來，全部排同一條：

```text
一整條 log（orders）：
  offset 0  {"order_id":42,"status":"created","ts":"10:00:01"}
  offset 1  {"order_id":77,"status":"created","ts":"10:00:02"}
  offset 2  {"order_id":42,"status":"paid",   "ts":"10:00:05"}
  offset 3  {"order_id":91,"status":"created","ts":"10:00:07"}
  offset 4  {"order_id":77,"status":"paid",   "ts":"10:00:09"}
  offset 5  {"order_id":42,"status":"shipped","ts":"10:00:12"}
```

乾淨、全域有序，一個 consumer 從 0 讀到 5 就是完整歷史。問題只有一個：只能一台讀。想加第二台分攤，它讀同一條 log 只會把 0 到 5 再讀一遍，不是分工。一條 log 沒辦法讓多台「分著讀」。

要分工，就得把 log 切開，切出來的每一條叫 [partition](chunk://partitions)。

---

## 切開之後：partition 是哪一條，offset 是第幾筆

topic 切成幾條就有幾個 partition；offset 是「在那一條裡的第幾筆」，每條自己從 0 編號：

```text
partition 0：
  offset 0  {"order_id":42,"status":"created"}
  offset 1  {"order_id":42,"status":"paid"}
  offset 2  {"order_id":42,"status":"shipped"}
partition 1：
  offset 0  {"order_id":77,"status":"created"}
  offset 1  {"order_id":77,"status":"paid"}
partition 2：
  offset 0  {"order_id":91,"status":"created"}
```

所以 partition 不是 offset。partition 是哪一本書，offset 是那本書的第幾頁：每本書都有第 1 頁，光說「第 1 頁」指不到內容。一筆訊息的完整地址是 (partition, offset) 一對，p0 的 offset 1 是 42 的 paid，p1 的 offset 1 是 77 的 paid，不同筆。

上面那張圖裡，42 的三筆全在 p0，而且照 created→paid→shipped 排。這不是巧合，是寫入時用 key 排進去的。

---

## 訊息進來，憑什麼決定進哪條

producer 發訊息時可以帶一個 key。有 key，hash(key) 決定落點，同 key 永遠進同一條；沒 key，broker 按負載亂丟。所以「碰到哪種資料該怎麼切」，真正要問的是：**這批資料裡，誰跟誰必須排隊？**

**誰先誰後無所謂 → 不設 key，均勻灑。** demo 的點擊事件就是這種，每筆獨立，最後只是加總。三筆點擊進來，沒設 key，broker 按負載分：

```text
10:00:01  {"short_key":"abc123"}  → 進 p0，成為 p0 的 offset 0
10:00:02  {"short_key":"xyz789"}  → 進 p1，成為 p1 的 offset 0
10:00:03  {"short_key":"abc123"}  → 進 p0，成為 p0 的 offset 1

落地後：
  p0:  [offset 0] abc123   [offset 1] abc123
  p1:  [offset 0] xyz789
```

注意 `abc123` 的兩筆這次剛好都進 p0，下次可能一筆 p0 一筆 p1，沒有保證，因為根本沒給 key。順序散了也無所謂，數總數不在乎誰先。demo 的 `WriteMessages` 沒給 Key，就是這一種。partition 數純看吞吐，一台消化不完就切多一點。

**同一個實體內要有序 → key = 實體 id。** 最常見的一種。訂單的 created→paid→shipped 不能亂，不同訂單互不相干：

```text
key=42 進來，hash(42) → 永遠 p0；key=77，hash(77) → 永遠 p1：
  p0:  [offset 0] 42 created   [offset 1] 42 paid   [offset 2] 42 shipped
  p1:  [offset 0] 77 created
```

沒設 key 會怎樣：`42 created` 被丟進 p0、`42 paid` 被丟進 p1，而順序只存在於單一 partition 內，跨 partition 之間沒有任何協調。假設 p0 前面積了 8000 筆、p1 是空的：

```text
10:00:01  42 created → p0（前面積壓 8000 筆）
10:00:05  42 paid    → p1（空的）

p1 那邊 10:00:06 就讀到 paid
p0 那邊啃完積壓，10:03 才讀到 created
```

下游先收到 paid、後收到 created，一筆還沒建立的訂單被付款，狀態機直接壞掉。而且這不用兩台 consumer 才發生，同一台讀 p0 加 p1 也一樣，它從兩條分別拉，哪條沒積壓就先拉到哪條。key 逼同一筆訂單全進同一條，隊伍內先進先出，順序才存在。

**全部都要有序 → 只能 1 條 partition。** 帳務總帳這種每筆跟前一筆有關的，只能一條排到底。代價是永遠單台讀，吞吐就是單台的上限。要全域順序就沒有平行，這是硬取捨，設定繞不開。

**key 選錯 → 熱點。**

```text
key = country：
  p0（TW）: ██████████████████  90% 流量
  p1（JP）: ██
  p2（US）: █
```

分到 p0 的那台累死，另外兩台閒著。key 要挑值夠分散的欄位：order_id 幾百萬個值，均勻；country 三個值，全擠一條。

---

## 一個 group 裡，誰讀哪一條

讀的單位是**整條 partition**，不是一筆一筆輪流發：

```text
group「analytics」，topic 有 2 條 partition：
  partition 0 ──整條──► consumer X
  partition 1 ──整條──► consumer Y
```

X 只碰 p0、Y 只碰 p1，各自在自己那條上把 offset 往前走。數量關係三種：

```text
consumer 比 partition 少   1 台配 2 條 → 一台自己讀 p0 加 p1
剛好                       2 台配 2 條 → 一台一條
consumer 比 partition 多   3 台配 2 條 → 第三台閒著沒事做
```

最後一行是實務上最常撞到的：**一個 group 內的平行上限就是 partition 數**，多開的 consumer 純待機。想再快，得加 partition，不是加 consumer。

實際的讀取（demo 的 consumer，Go）：

```go
r := kafka.NewReader(kafka.ReaderConfig{
    Topic:   "click-events",
    GroupID: "analytics-consumer",
})
for {
    msg, _ := r.ReadMessage(ctx)
    // msg.Partition  哪一條
    // msg.Offset     那條裡的第幾筆
    // msg.Value      JSON bytes
}
```

讀完，consumer 把書籤 commit 回 Kafka：「(analytics-consumer, p0) 讀到 2」。書籤綁在 (group, partition) 這一對上，掛掉重啟、或這條 partition 換一台接手，看書籤就知道從第幾筆繼續（[consumer groups](chunk://consumer-groups) 這片有 rebalance 的細節）。

---

## 那為什麼換個 group 又能從頭讀

「一條 partition 只給一個 consumer」只在**同一個 group 內**成立。跨 group，同一條 partition 可以同時被好幾個 group 讀：

```text
partition 0 ─┬─► group analytics 的 consumer X（書籤 500）
             └─► group billing   的 consumer M（書籤 20）
```

X 和 M 都在讀 p0，互不干擾，因為書籤各記各的。兩層規則擺在一起看：

```text
group 內  →  分工：partition 分掉，一條一台，一筆只被這個 group 處理一次
跨 group  →  廣播：每個 group 各拿完整一份，各自從頭讀
```

[why-kafka](article://why-kafka) 說的「一份資料餵多個下游」，機制就是這個：每個下游開一個 group。

---

## 收：三個旋鈕

```text
key          → 誰跟誰必須排隊（順序的範圍）
partition 數 → 一個 group 內最多幾台同時做事（平行上限）
group 數     → 這份資料餵幾個下游（每個 group 完整一份）
```

設計時照這個順序問：先「誰要有序」選 key，再「要多少吞吐」定 partition 數，最後「幾個下游」開 group。三個問題互不干涉。Kafka 看起來的複雜，大半就是這三個旋鈕的組合。
