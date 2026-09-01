---
title: "已經有 Postgres 和 Redis 了，為什麼還要多養一個 Kafka"
slug: why-kafka
date: 2026-07-12
subtitle: "Kafka 只有一個答案是別人給不了的：它把訊息留著。這一篇看留著解鎖了什麼，又要付什麼代價。"
chapter: "messaging"
tags: [kafka, event-sourcing, cdc, replay, streaming, system-design]
related: [message-system-axes, kafka-partitions-groups, sns-sqs, rabbitmq-routing, the-log, url-shortener-demo, queue-peak-shaving]
---

# 已經有 Postgres 和 Redis 了，為什麼還要多養一個 Kafka

手上已經有 Postgres 存資料、Redis 做快取。Kafka 是第三個要維運、要監控、會壞的系統。它補上的，是 Postgres 和 Redis 缺的哪一塊？

先把 Kafka 在四個問題上定位（[上一篇](article://message-system-axes)講的那四題）：送法看 consumer group、推拉是 pull、位置在後端。這三題 RabbitMQ、SQS 多少也答得出來。真正只有 Kafka 給的，是存法那一題的答案：**留著**。訊息讀過不刪，consumer 自己記讀到哪一筆。

Kafka 那些聽起來各自獨立的用法，replay、多下游、CDC、event sourcing，說到底都是「留」帶出來的。下面一個一個看，也看它們共同要付的代價。

---

## 留著，所以壞掉可以重來

consumer 掛掉這件事，queue 其實護得住：沒 ack 的訊息會重新投遞。真正的分歧在 ack 之後：queue 刪掉，Kafka 留著，consumer 記的只是一個叫 offset 的書籤，標著讀到第幾筆。

差在哪，用 demo 的點擊事件跑一次。consumer 讀 `click-events`、判斷裝置、寫進 ClickHouse：

```text
log（讀過不刪）：
  offset 0  {"short_key":"abc123","user_agent":"...iPhone...","device":"mobile"}
  offset 1  {"short_key":"xyz789","user_agent":"...Windows...","device":"desktop"}
  offset 2  {"short_key":"abc123","user_agent":"...Android...","device":"mobile"}
  offset 3  {"short_key":"qqq111","user_agent":"...iPhone...","device":"mobile"}

consumer 書籤 = 4，四筆都寫進 ClickHouse 了
```

某天發現 device 的判斷有 bug，Android 全被記成 desktop，ClickHouse 那批是髒的。Kafka 的解法：修好 code，把書籤倒回 0，四筆重讀一遍，ClickHouse 清掉重建。queue 給不了這條路，那四筆在 ack 的當下就刪了，寫壞的資料沒有原料可以重算。

補歷史也是同一招。一個全新的服務今天上線，想要過去三個月的資料，從 offset 0 讀到尾就有了。offset 怎麼運作、多個 consumer 怎麼分讀，看 [The Log](article://the-log) 和 [consumer groups](chunk://consumer-groups)。

---

## 留著，所以一份資料多人各取

同一份 log，帳單、分析、稽核三個服務各開一個 consumer group，各自記各自的 offset，互不干擾。想加第四個下游，開一個新 group 就好，不用動現有的服務，也不用叫 producer 多發一份。

```bash
# 同一個 topic，兩個 group 各讀各的、各記各的 offset
kafka-console-consumer --topic orders --group billing   --from-beginning
kafka-console-consumer --topic orders --group analytics --from-beginning
```

書籤各自走，跑一陣子之後的實況：

```text
log：        [0][1][2] ……………………………… [498][499][500]（尾巴）
billing      書籤 500   即時算帳，緊追尾巴
analytics    書籤 20    每晚批次跑，白天慢慢落後沒關係
alerts       書籤 0     今天剛上線，正從三個月前開始補
```

三個速度完全不同的下游讀同一份資料，誰也不用等誰，誰也不影響誰。

這跟 SNS 那種 fan-out 不一樣。SNS 是發布的當下就把訊息複製成 N 份，推給 N 個訂閱者；Kafka 只存一份，讀的人各自來拿。前者的成本在寫入端，後者把選擇權留給讀取端。差別的根源還是「留」：因為留著，讀取可以晚一點、可以來很多次、可以來很多人。

---

## 留著，所以 DB 改了能通知出去

假設訂單狀態存在 Postgres，付款、庫存、通知三個服務都要在它變動時反應。最直覺的做法是 app 寫完 DB 再自己發事件，也就是 dual-write，但這是兩次獨立的寫入，任一次失敗就分岔。

[CDC](chunk://cdc)（Change Data Capture）是另一種做法：DB 每次 commit 本來就在寫 [WAL](chunk://wal)，Debezium 去接這份 WAL，把每筆變更轉成事件送進 Kafka。app 只寫 Postgres，下游各自訂閱，DB 根本不知道 Kafka 存在。

實際跑起來，app 從頭到尾只執行一句 SQL：

```sql
UPDATE orders SET status = 'paid' WHERE id = 42;
```

commit 進了 WAL，Debezium 讀到這筆變更，轉成事件寫進 Kafka 的 `orders` topic：

```json
{"op": "u",
 "before": {"id": 42, "status": "pending", "amount": 990},
 "after":  {"id": 42, "status": "paid",    "amount": 990}}
```

付款、庫存、通知各開一個 consumer group 收到這筆，看到 status 從 pending 變 paid，各做各的反應。app 沒發過任何事件，是 WAL 裡本來就有的那筆寫入被撈出來變成了事件。

這裡跟「留」的關係要看清楚：**CDC 搭的是「DB 本來就要寫這一筆」的便車。**訂單那一列是系統的真相，非寫不可，CDC 只是把這個既有的寫入撈進 Kafka。反過來，如果一件事根本不需要在 DB 留一列（例如一次點擊），就別為了用 CDC 去硬造一筆 DB 寫入，app 直接發進 Kafka 就好，不用繞一趟 DB。看的不是這件事重不重要，是它算不算 DB 裡的一個狀態。

---

## 留到極致：log 當真相，DB 當下游

CDC 是 DB 當真相、Kafka 當衍生。把這個順序倒過來，就是 event sourcing：先把事件寫進 Kafka，DB 變成從 log 重放出來的一份快照（materialized view），可以丟掉重建。

用帳戶餘額看。存的不是「餘額 120」這個結果，是每筆變動：

```text
topic account-events（key = 帳戶 id，同帳戶進同一個 partition，順序不亂）：
  offset 0  {"account":"A","op":"deposit",  "amount":100}
  offset 1  {"account":"A","op":"withdraw", "amount":30}
  offset 2  {"account":"A","op":"deposit",  "amount":50}

現在的餘額？重放加總：100 − 30 + 50 = 120，存成一份視圖
上週三當時的餘額？重放到當時的位置：讀到 offset 1 → 70
DB 裡 balance = 120 那列只是快照，砍掉重放一次就回來
```

為什麼有人要把最慢的 DB 從主角換成下游？上面那三行事件就是理由：任何時間點的狀態都重放得回來，要一份新視圖（換個資料庫、換個聚合方式）也只要重放一次。代價是查當下狀態多一道手續，得先物化成視圖才查得到；而且視圖通常慢一拍更新，剛寫進 log 的那筆，馬上查不一定看得到（read-after-write 不再保證）。

DB-first 還是 log-first，分界在「真相住在哪」：需要關聯查詢、外鍵、約束當真相，DB-first 配 CDC；事件流本身就是真相，log-first 走 event sourcing。不管哪種，底下都是 Kafka 把 log 留著，差別只在 DB 和 log 誰衍生誰。

---

## 留著，就得自己管這些

留著解鎖了上面這些，但有幾件事變成要自己處理：

| 代價 | 要自己處理的 |
|---|---|
| retention | 訊息留多久要自己定，磁碟會滿，過期就真的沒了 |
| 順序 | 只保證在單一 [partition](chunk://partitions) 內有序，跨 partition 沒有全域順序 |
| offset | 進度自己記，記錯了就重複或漏讀 |
| 一次性 | exactly-once 是有條件的，多數人選 at-least-once 配消費端冪等（[exactly-once](chunk://exactly-once)） |

RabbitMQ、SQS 把這些都省了（ack 完就刪，沒有 retention 要管、沒有 offset 要記），換來的是它們也給不了 replay。要 replay 就得自己管上面這些，不要就不用。

---

## 什麼時候不需要 Kafka

如果需求只是 A 把一個任務交給 B、B 做完就算，不需要重讀、不需要多個下游、不需要當真相，那 RabbitMQ 或 SQS 更簡單，不必為了「留」多養一個系統。

[url-shortener demo](article://url-shortener-demo) 用 Kafka 接 click 是對的，但它現在用到的只是「先收著，讓 ClickHouse 慢慢批次消化」這層緩衝，還沒真的用到 replay 或多下游。等哪天想把同一批 click 再餵一個即時告警服務，開一個新 consumer group 就接上，原本的 pipeline 一行不用改。
