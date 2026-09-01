---
title: "Exactly Once"
slug: exactly-once
brief: "冪等 producer + 交易式 consumer。真的做得到嗎？"
date: 2026-06-12
updated: 2026-07-20
revisions: 1
---

# Exactly Once

> 訊息系統能保證一則訊息「剛好處理一次」嗎？不丟、也不重複？

三種投遞保證（at-most / at-least / exactly-once）的定義看 [投遞保證](chunk://delivery-guarantees)。這篇只講最難的那級。

會重複或會丟，根本原因是你沒辦法把「做事」跟「記下我做過了」變成一個原子動作：ack 在網路上掉了，producer 不知道對方收到沒，只能重送，於是重複。

## 線路上的 exactly-once 做不到

網路上你永遠無法確定對方收到沒（two generals problem），所以送方一定要能重送，送了兩次這種重複，沒辦法從根本上避免。實務的 exactly-once 是換個方向：**at-least-once 投遞 + dedup，讓重複到了也沒有副作用**。效果跟「剛好一次」沒有差別，所以更精確的講法是 exactly-once **processing / effect**。

consumer 端要做到[冪等](chunk://idempotency)：同一則訊息做第二次等於沒做（例如帶 unique key，看過的就跳過）。`at-least-once + 冪等` 的最終狀態，跟「剛好處理一次」一模一樣。

## Kafka 的 EOS

Kafka 把這套包進框架：

- **冪等 producer**：每則訊息帶 producer id + 序號，broker 看到重複序號就丟掉，producer 重送不會變兩份。
- **交易（transaction）**：把「讀訊息 → 算出結果 → commit offset」綁成一個原子交易，全成功或全不算，失敗就乾淨重來。

但要端到端進外部系統（寫 DB），那一段的 dedup 還是要你自己負責。

---

真正的 exactly-once delivery 做不到，能做的是 at-least-once + 冪等，讓重複沒有效果。大多數系統就用這個組合，不必開 Kafka 完整的交易機制。
