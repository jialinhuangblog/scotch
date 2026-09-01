---
title: "Domain Event"
slug: domain-event
brief: "業務上發生了某件事，發一個事件出去，關心的人各自反應，發的人不用管誰在聽。"
date: 2026-06-14
article: ddd-textbook-vs-real
---

# Domain Event

業務上發生了一件有意義的事（下單成功、付款完成、貨送到），用一個事件把它廣播出去。關心這件事的人各自訂閱、各自反應，而**觸發的那段 code 不用知道有誰在聽**。

名字用過去式：`OrderPlaced`、`PaymentReceived`、`ShipmentDelivered`，強調「已經發生」。

## 解決什麼

沒有 event，下單成功後那段 code 得自己一個個去呼叫：扣庫存、寄 email、記 analytics……每加一個下游就要回去改下單的 code。

有了 event，下單只負責發一個 `OrderPlaced`：

```text
下單成功 → 發出 OrderPlaced
              ├→ 庫存 service：扣庫存
              ├→ 通知 service：寄確認信
              └→ 分析 service：記一筆
```

三個下游各自訂閱、各做各的，下單的 code 從頭到尾不知道它們存在。加第四個下游也不用回頭改下單。

像公告欄貼一張「訂單成立了」：誰關心誰自己來看、自己處理，貼公告的人不用一個個打電話通知。

## 注意

Domain Event 常跟 [message queue](chunk://message-queue-comparison)、event-driven 架構接在一起（事件丟進 Kafka，跨服務訂閱）。但別過頭，把每個狀態變化都做成 event、上 Event Sourcing，沒正當理由就是過度設計，是公認的 anti-pattern。
