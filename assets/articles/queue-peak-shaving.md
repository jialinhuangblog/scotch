---
title: "訊息會在哪裡遺漏，遺漏了之後怎麼補回來"
slug: queue-peak-shaving
subtitle: "用 queue 削峰、把尖峰緩下來，但 queue 自己會漏訊息：producer、broker、consumer 三處都可能漏，也都有解決辦法。"
chapter: "buffer"
tags: [kafka, message-queue, idempotency, exactly-once, system-design-interview]
date: 2026-03-31
related: [cache-hot-key, rate-limiter, scaling-first-move]
---

# 訊息會在哪裡遺漏，遺漏了之後怎麼補回來

Queue 放在 DB 前面吸收寫入流量，但 producer、broker、consumer 任何一處出錯，訊息都可能遺失。

[Cache](article://cache-hot-key) 跟 queue 都是**在兩端之間放一層 buffer**。差別在 cache 吸收讀取、queue 吸收寫入，所以失效的後果跟防禦方式也不一樣。

---

## 為什麼需要 Queue：削峰

某個時段突然湧入大量請求。沒有 queue 的話，所有請求直接送到 DB。

```text
沒有 queue：
  10,000 req/s → DB → DB 負載過高 → 掛了

有 queue：
  10,000 req/s → Queue（先收著）→ Consumer 每秒拉 2,000 → DB 穩穩的
```

Producer 寫入快，consumer 讀取慢，差額堆在 queue 裡。尖峰過後 consumer 慢慢消化完。用戶的請求不會被拒絕，只是處理延遲幾十秒。

任何允許寫入跟讀取速度不一樣的元件，都能拿來削峰：

| 工具 | 能不能削峰 | 特性 |
|---|---|---|
| Kafka | 能 | 訊息存硬碟，堆再多都行 |
| RabbitMQ | 能 | 3.12 起 classic queue 會把訊息寫進磁碟，記憶體只留一小部分準備送出，堆積時記憶體用量維持平穩 |
| Redis List | 能 | LPUSH / RPOP，簡單但沒有 ack |
| SQS | 能 | AWS 託管，不用自己維護 |
| 資料庫 table | 能 | 寫一筆 row 當 queue，worker 定期撈，最土但能用 |

上面幾個都能削峰，但訊息讀完之後，Kafka 留著，RabbitMQ、SQS、Redis List 刪掉，所以分成兩派：

### Log 派 vs Queue 派

| | Log 派（Kafka） | Queue 派（RabbitMQ、SQS、Redis List） |
|---|---|---|
| 訊息讀完後 | 不刪，等 retention 到期 | 刪掉 |
| 多個 consumer | 各自記 offset，零成本 | 要複製到多個 queue（fanout） |
| replay（重讀舊訊息） | 可以，把 offset 倒回去 | 不行，刪了就沒了 |
| 訊息的性質 | 發生過的事實（event） | 要完成的任務（task） |

```text
Log 派：訊息是歷史紀錄，寫了不動，讀者自己追進度
  Kafka partition: [msg1][msg2][msg3][msg4][msg5]
                          ↑              ↑
                   Consumer A 讀到這  Consumer B 讀到這

Queue 派：訊息是任務，處理完就丟
  RabbitMQ queue: [msg1][msg2][msg3]
                    ↑
              Consumer A 拿走 → ack → 刪掉 → Consumer B 永遠看不到
```

Click event、交易紀錄、用戶行為這些「發生過的事實」→ 用 Kafka，因為多個系統（analytics、推薦、風控）各自需要讀。

發送 email、處理訂單、圖片壓縮這些「要完成的任務」→ 用 RabbitMQ 或 SQS，處理完就不需要了。

詳細選型見 [Queue 選型](chunk://message-queue-comparison)。

---

## Queue 本身也會丟訊息

queue 把尖峰流量接下來了，但訊息會不會在 queue 裡丟掉呢？

訊息在三個環節都可能丟。

```text
Producer ──→ Broker ──→ Consumer
   ①            ②           ③
  送出去       收到但        收到但
  沒收到       沒存好        沒處理完
```

---

## ① Producer：送出去但 Broker 沒收到

網路斷了。Producer 以為送了，Broker 沒收到。

### 選擇：等不等 ack

```text
acks=0     送出去就不管        最快，會丟
acks=1     leader 收到回 ack   可能丟（leader 掛了還沒同步到 replica）
acks=all   所有 in-sync replica 收到   最慢，不丟
```

in-sync replica（ISR）是跟 leader 同步進度沒落後的那幾台。

沒收到 ack 就重送。大部分場景用 `acks=all`。

### 代價

`acks=all` 要等所有 in-sync replica 確認，延遲會增加。但 producer 端的延遲通常不是瓶頸，寫入量才是。

---

## ② Broker：收到但沒存好就掛了

Broker 收到訊息，還在記憶體裡，機器斷電。

### 選擇：存幾份

```text
replication factor = 1   只存一份，那台掛了就沒了
replication factor = 3   存三份，一台掛了還有兩台
```

搭配 `acks=all` 跟 `min.insync.replicas=2`，producer 送一筆訊息，至少要兩台 broker 寫入成功才回 ack。一台掛了，另一台還有完整資料。要是 in-sync 的只剩一台，寫入會直接被拒絕，而不是默默只存一份。

### 代價

多副本代表多倍儲存空間跟同步延遲，換來的是一台 broker 掛掉也不丟訊息。

---

## ③ Consumer：收到但沒處理完就掛了

Consumer 從 Kafka 拉了訊息，auto commit offset（自動回報「我讀完了」），但還沒處理完就掛了。Kafka 記錄的 offset 已經越過那批，重啟後不會再送。

### 選擇：什麼時候回報「我讀完了」

```text
自動 commit（預設）：
  拉到 → 立刻 commit → 處理中掛了 → 訊息丟了

手動 commit：
  拉到 → 處理完 → 才 commit → 處理中掛了 → 重啟從上次 offset 重來
```

### 代價

手動 commit 慢一點（多一次確認），但保證不丟。

---

## 不丟換來的麻煩，是同一筆可能跑兩次

三個環節都靠「沒確認就重送」來保證不丟。但重送可能導致同一筆訊息處理兩次。

```text
Consumer 處理完，寫入 DB 成功，但 commit offset 失敗
  → 重啟後從上次 offset 重來
  → 同一筆訊息又處理了一次
  → DB 裡多了一筆重複
```

所以 consumer 必須做**冪等**（[Idempotency](chunk://idempotency)）：同一筆訊息處理兩次，結果跟一次一樣。

```text
扣款訊息 {order_id: 123, amount: 100}
  → 第一次：查 order_id=123 沒處理過 → 扣 100 → 記錄已處理
  → 重複收到：查 order_id=123 已處理 → 跳過
```

---

## 三種投遞語義

| 語義 | 意思 | 怎麼做到 | 代價 |
|---|---|---|---|
| At most once | 最多一次，可能丟 | 送完不管，auto commit | 快，但會丟 |
| At least once | 至少一次，可能重複 | ack + 手動 commit | 不丟，要冪等 |
| Exactly once | 恰好一次 | Kafka EOS（有條件） | 最慢，限制多 |

**at least once** 是「沒收到 ack 就重送」，保證不丟，但可能送到兩次。**冪等（idempotent）** 是讓 consumer 同一筆做兩次跟做一次結果一樣，用來消掉那些重複。兩個一起用，效果接近 exactly once，但不用真的做到「恰好投遞一次」。

### Exactly once 真的做得到嗎？

**EOS（Exactly-Once Semantics，恰好一次語義）** 是 Kafka 從 0.11 提供的：保證每筆訊息不丟也不重複。但有條件：

```text
Kafka → Kafka：exactly once ✓
  （Kafka 內部用 transaction 保證，producer 和 consumer 都在 Kafka 裡）

Kafka → 外部 DB：回到 at least once + 冪等
  （Kafka 控制不了 DB 有沒有寫成功）
```

只要寫入目標在 Kafka 外面，這個保證就不成立。所以實務上 exactly once 幾乎等於「at least once + 冪等」，只是 Kafka 在自己的範圍內省掉了一些冪等工作。

---

## 再往下追問

---

> **「Consumer 處理太慢，queue 堆積越來越多。怎麼辦？」**
>
> 水平擴展 consumer。Kafka 的 partition 機制本來就支援：一個 partition 只能被同一個 consumer group 裡的一個 consumer 讀。加 consumer 就加吞吐量。
>
> ```text
> 3 partitions, 1 consumer  → 1 個人讀 3 個 partition
> 3 partitions, 3 consumers → 每人讀 1 個，吞吐量 x3
> 3 partitions, 5 consumers → 2 個閒著（consumer 不能多於 partition）
> ```
>
> Consumer 不夠快 → 先加 consumer。Consumer 數量已經等於 partition 數量 → 加 partition（需要 rebalance）。

---

> **「Producer 送太快，Broker 來不及寫。怎麼辦？」**
>
> Producer 端做 batching：累積一批再一起送，減少網路往返次數。Kafka producer 預設就會 batch（`linger.ms` + `batch.size`）。
>
> Broker 端加 partition：每個 partition 是獨立的 append-only log，寫入可以並行。Partition 越多，寫入吞吐越高。

---

> **「Queue 整個掛了（Kafka cluster 全掛）。怎麼辦？」**
>
> 跟 cache 雪崩一樣的問題：buffer 層消失，流量直接送到下游。
>
> 兩種策略：
>
> - **降級**：Kafka 掛了就直接寫 DB，犧牲削峰但不丟資料，前提是 DB 能短暫承受尖峰。
> - **本地暫存**：producer 寫入本地檔案或記憶體 queue，Kafka 恢復後補送。不打 DB，但 producer 重啟會丟。
>
> DB 能短暫承受尖峰，就降級直接寫 DB，一筆都不丟。DB 承受不了，就改寫本地暫存，代價是 producer 重啟時，還沒補送的那批會丟掉。

---

## 跟上一篇的對照

| | Cache（吸收讀取） | Queue（吸收寫入） |
|---|---|---|
| 正常作用 | DB 不用處理重複的讀取 | DB 不用承受尖峰寫入 |
| 失效時 | 雪崩 / 穿透 / 擊穿 | 訊息丟失 / 重複消費 |
| 核心防禦 | TTL 隨機、mutex、bloom filter | ack、手動 commit、冪等 |
| 共同點 | buffer 層消失 → DB 負載過高 | buffer 層出事 → 資料不一致 |
