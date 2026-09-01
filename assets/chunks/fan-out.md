---
title: "Fan-out (Push vs Pull)"
slug: fan-out
brief: "Push 發文時就寫進所有 follower 的 feed，Pull 讀取時才去撈所有 following，純用哪種到大規模都會卡。"
date: 2026-03-21
---

# Fan-out (Push vs Pull)

> 一個人發了一則訊息，要讓 N 個人看到。是發的時候推給所有人，還是看的時候去拉？

## 場景

社群平台，用戶 A 有 500 個 follower。A 發了一則貼文。500 個 follower 下次打開 app 時，要看到這則貼文。

A 的貼文怎麼出現在 500 個人的 feed 裡？

## Fan-out on Write（推模型）

A 發文的瞬間，系統把這則貼文寫入每個 follower 的 feed。

```text
A 發文 "hello"
  → 寫入 follower_1 的 feed
  → 寫入 follower_2 的 feed
  → ...
  → 寫入 follower_500 的 feed
```

每個用戶的 feed 是一張預先組好的表。打開 app 時直接讀自己的 feed，不需要計算。

```text
讀 feed：SELECT * FROM feed WHERE user_id = 123 ORDER BY time DESC
→ 一張表，一次查詢。快。
```

**優點**：讀非常快，feed 已經準備好了。

**代價在寫入端**：A 有 500 個 follower，發一則文就是 500 次寫入。名人帳號有 5000 萬 follower，一則文要寫 5000 萬行。

```text
普通用戶（500 followers）：500 次寫入，幾百毫秒，可以接受
名人帳號（50M followers）：50,000,000 次寫入，可能要幾分鐘
```

名人發一則文，幾分鐘後某些 follower 才看到。而且這幾分鐘裡 message queue 的寫入量暴增，影響其他操作。

## Fan-out on Read（拉模型）

不在發文時推。用戶打開 app 時，系統即時去查「我 follow 了誰？他們最近發了什麼？」然後合併排序。

```text
用戶 X 打開 app：
  → 查 X follow 了 A, B, C, D, E...（200 人）
  → 查 A 最近的貼文
  → 查 B 最近的貼文
  → ...
  → 合併排序，取前 20 則
```

**優點**：發文只寫一次（寫進自己的貼文表）。名人發文也只是一次寫入。

**代價在讀取端**：每次打開 app 都要查 200 個人的貼文再合併。follow 越多人，查詢越慢。

```text
follow 200 人：200 次查詢 + merge sort，可能 200ms
follow 2000 人：2000 次查詢 + merge sort，可能 2 秒
```

而且每個用戶每次打開都要算。1 億日活用戶，每天要算 1 億次以上。

## 為什麼不能只選一個

```text
               寫入量       讀取速度    名人帳號    普通帳號
Fan-out Write  O(followers)  快         撐不住      剛好
Fan-out Read   O(1)          慢         剛好        浪費
```

兩個極端都有明顯的瓶頸。

## 混合模型

Twitter（現 X）的做法：普通用戶用推，名人帳號用拉。

```text
普通用戶 A（500 followers）發文：
  → fan-out on write，推到 500 個 feed

名人帳號 B（50M followers）發文：
  → 只寫入 B 自己的貼文表，不推

用戶 X 打開 app：
  → 讀 X 的 feed（已經有普通用戶推過來的貼文）
  → 另外查 X follow 的名人帳號的最近貼文
  → 合併排序
```

閾值通常是 follower 數量。超過某個門檻（例如 10 萬）就切換成拉模型。

大部分用戶的 feed 已經有 90% 的內容（來自 fan-out on write），只需要額外拉少數幾個名人帳號的貼文。讀的時候快，名人發文時寫入也不會一下子衝太高。

## 背後的基礎設施

Fan-out on write 的 500 次寫入不是同步的。通常是丟進 message queue（Kafka、SQS），由 worker 異步處理。

```text
A 發文 → 寫入貼文表 → 發一個 event 到 message queue
                         ↓
              Fan-out worker 消費 event
              → 查 A 的 follower list
              → 批量寫入每個 follower 的 feed
```

如果 fan-out worker 掛了或重試，需要冪等寫入：用 (user_id, post_id) 當 unique key，重複寫入不會產生重複貼文。

## 不只社群平台

Fan-out 模式出現在很多場景：

- **通知系統**：一個事件觸發 N 個用戶的通知
- **即時聊天群組**：一則訊息要讓群組內所有人看到
- **電商庫存更新**：一個 SKU 降價，所有關注這個商品的用戶要收到推播

決策邏輯都一樣：接收者少就推，接收者多就拉，混合最常見。

---

fan-out on write 是寫的時候多做事，換來讀很快；fan-out on read 反過來，寫很輕但讀要現算。實務上混合使用：普通帳號推，名人帳號拉。
