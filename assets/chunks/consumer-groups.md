---
title: "Consumer Groups"
slug: consumer-groups
brief: "一組 consumer 分工讀同一個 topic。partition 分給誰、每個 partition 讀到哪，是兩件不同的事。"
date: 2026-06-12
updated: 2026-07-12
revisions: 2
article: message-system-axes
---

# Consumer Groups

> 一個 topic 每秒進來幾萬則訊息，一個 consumer 讀不完，怎麼分給多台一起讀又不重複？

## 一組 consumer 分工讀一個 topic

consumer group 是一群一起讀同一個 topic 的 consumer。規則很簡單：一個 [partition](chunk://partitions) 同時只給組裡的一個 consumer 讀。

所以多開幾個 consumer，就是把 partition 分給更多人一起處理，但平行度卡在 partition 數：10 個 partition、開 10 個 consumer 剛好一人一個，開到第 11 個就只能閒著。

```text
topic（4 個 partition）        consumer group「billing」
  partition 0  ───────────────►  consumer A
  partition 1  ───────────────►  consumer A
  partition 2  ───────────────►  consumer B
  partition 3  ───────────────►  consumer B
```

沿用 [partitions](chunk://partitions) 的收銀台比喻：一個 partition 是一個收銀台，consumer 是站在收銀台後面結帳的收銀員，一個 consumer group 就是同一個 shift 的收銀員，任務是把所有收銀台的顧客都結完。一條收銀台同時只給一個收銀員顧，收銀員比收銀台多就有人閒著。

## 分配跟 offset 是兩件事

這裡最容易混淆。group 運作時其實有兩套機制，分開看就清楚了。

**分配**：哪個 partition 歸哪個 consumer。上面那張圖就是分配——A 管 0、1，B 管 2、3。這是組內的分工（load balancing），相對固定，只有在有人加入或離開時才重新分（見下面的 rebalance）。一個 consumer 被分到幾個 partition，是同時平行讀它們，不是讀完一個換下一個。

**offset**：在一個 partition 內，讀到第幾則了。每個 partition 自己是一條編號 0、1、2、3… 的 log，offset 就是這條 log 上的書籤，指「下一則要讀第幾號」。

所以 offset 記的不是「讀到哪個 partition」，是「在某個 partition 裡走到哪」。分配決定你拿到哪幾條 partition，offset 決定你在每條裡面走到哪。

## offset 綁在 (group, partition) 上

offset 是「某個 group，在某個 partition 上讀到第幾號」，存在 Kafka 自己的 `__consumer_offsets` 裡。

```text
partition 0:  [#0][#1][#2][#3][#4][#5] ...
                          ↑ billing 在 p0 的 offset = 3（下一則讀 #3）
```

因為書籤綁在 (group, partition) 這一對上，所以 consumer 掛了重啟、或換一台接手，看書籤就知道從第幾號繼續，不會從頭也不會跳過。

回到收銀台：offset 就是每個收銀台上「結到第幾位顧客」的記號，收銀員換班，看記號就知道從第幾位接著結。

## 不同 group 各讀各的

訊息不是讀完就消失。不同 group 各有自己的一整套 offset，互不影響：同一個 topic，billing group 從頭讀一遍算帳，analytics group 也從頭讀一遍做報表，兩邊各看各的進度。這就是 Kafka 一份資料餵多個下游的方式。

所以有兩個層次：跨 group 是各讀各的整份（fan out），group 內才是把 partition 分掉（分工）。

## Rebalance

有 consumer 加入或離開時，partition 要在組內重新分配，這段期間短暫停讀，叫 rebalance。新接手的 consumer 從原本那個 partition 的 offset 接著讀，不會重來。consumer 數量頻繁變動會一直觸發 rebalance，是常見的效能問題。

---

consumer group 拿 partition 當分工、用 offset 記到哪了，所以同一個 topic 可以多台一起讀又不會重複；換一個 group 還能從頭再讀一次。
