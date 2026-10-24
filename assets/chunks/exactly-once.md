---
title: "Exactly Once"
slug: exactly-once
brief: "冪等 producer，把輸出寫入和 offset commit 綁在同一個交易裡，下游再設 read_committed。真的做得到嗎？"
date: 2026-06-12
updated: 2026-10-19
revisions: 5
---

# Exactly Once

> 訊息系統能保證一則訊息「剛好處理一次」嗎？不丟、也不重複？

三種投遞保證（at-most / at-least / exactly-once）的定義看 [投遞保證](chunk://delivery-guarantees)。

先看重複是怎麼來的。付款服務從 queue 讀到訊息 #42「訂單 1001 扣 300 元」。它向銀行 API 扣了 300 元，正要回 ack 告訴 broker 這則處理完了，process 被 OOM kill。broker 沒收到 ack，等 visibility timeout 到，把 #42 再投遞一次。新的 worker 讀到 #42，又扣 300 元。訂單 1001 被扣了 600。

要不重複，得把「扣款」跟「記下 #42 做過了」變成一個原子動作，但扣款在銀行那台機器上，記錄在 broker 那台，中間隔著網路。反過來先 ack 再扣款，crash 的位置換到 ack 之後，這筆就一毛都沒扣，變成丟。

## 線路上的 exactly-once 做不到

網路上永遠無法確定對方收到沒（two generals problem），所以送方一定要能重送，#42 到兩次這種事沒辦法從根本上避免。實務上的 exactly-once 是 **at-least-once 投遞加上 dedup，讓重複到了也沒有副作用**。效果跟「剛好一次」沒有差別，所以更精確的講法是 exactly-once **processing / effect**。

落到上面那個例子，第一個反應通常是 consumer 自己記錄：扣款前先查 `payments` 表有沒有 order_id = 1001，有就跳過，扣完再把 1001 寫進去。可是這只是把「記錄」從 broker 搬到 `payments` 表，銀行還是另一台機器。銀行扣了 300、worker 還沒寫進 `payments` 就被 kill，第二次 #42 到，查不到 1001，又扣一次。visibility timeout 到期時第一個 worker 要是還活著，兩個 worker 同時查、同時查不到，也一樣扣兩次。

所以 dedup 要做在扣款的那一端，也就是[冪等](chunk://idempotency)的扣款請求：worker 呼叫銀行 API 時帶上 `idempotency_key = 1001`，銀行把「這個 key 扣過了」跟扣款寫在自己的同一個交易裡。第二次 #42 到，新的 worker 送出同一個 key，銀行認出來，不再扣款，直接回第一次的結果。前提是銀行 API 接受 idempotency key；不接受的話，consumer 這邊查得再仔細，也攔不下銀行扣完、還沒寫進 `payments` 就 crash 的那一次。

## Kafka 的 EOS

Kafka 把這套包進框架：

- **冪等 producer**：每則訊息帶 producer id + 序號，broker 看到重複序號就丟掉，producer 重送不會變兩份。
- **交易（transaction）**：consumer 讀到 #42，算出結果要寫進另一個 topic，「寫出結果訊息」跟「commit #42 的 offset」綁成一個交易，全成功或全不算。crash 在中間，交易 abort，offset 沒動，重來一次再寫一份新的結果。abort 掉的那份還留在 topic 裡，下游 consumer 要設 `isolation.level=read_committed` 才會略過它。這個設定的預設值是 `read_uncommitted`，沿用預設的話，下游會讀到 abort 的那份加上重來的那份，一樣是兩份。

這套只在 Kafka 自己的 topic 之間成立。結果要寫進外部系統（例如上面的銀行 API 或 DB）時，Kafka 的交易管不到那裡，那一段的 dedup 還是要自己處理。寫進 DB 的話，可以把結果跟 offset 寫進同一個 DB 交易，重啟時從 DB 讀回 offset，一樣是 exactly once；銀行 API 沒辦法跟 offset 放進同一個交易，只能靠上面的 idempotency key。

只用 at-least-once 加上 consumer 冪等，最終狀態一樣，而且不用開 Kafka 完整的交易機制。
