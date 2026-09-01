---
title: "Outbox Pattern"
slug: outbox-pattern
brief: "event 跟業務寫入包進同一個 transaction 的 outbox 表，由 CDC 推出去，避免雙寫不一致。"
date: 2026-07-20
updated: 2026-07-20
revisions: 2
---

# Outbox Pattern

寫 DB 跟發 event 是兩個系統，分開做就是雙寫：DB 成功、Kafka 失敗，事件就丟了。Outbox pattern 把「要發的 event」也當成一筆資料，跟業務寫入包進同一個 transaction：

```text
BEGIN;
  INSERT INTO orders (...);
  INSERT INTO outbox (event_type, payload);
COMMIT;
       ↓
   CDC 把 outbox 推 Kafka
```

Transaction 保證兩筆一起成功或一起失敗，之後由 [CDC](chunk://cdc) 監聽 outbox 表，把 event 推到 Kafka。

好處：app code 控制要送什麼 event 出去（[domain event](chunk://domain-event)），不直接暴露 DB schema 給下游。比直接 CDC 業務 table 更乾淨。代價是多一張表，已送出的 rows 還要定期清理。

兩個常見疑問：

- **outbox 是什麼特殊機制嗎？** 不是，就是一張自己 `CREATE TABLE` 的普通表，欄位大概 `id, event_type, payload, created_at`。特別的是用法：它只被 INSERT，讀取的人是 CDC，不是 app。
- **跟 [WAL](chunk://wal) 什麼關係？** WAL 是 DB 引擎自己的日誌，任何寫入（包括往 outbox 的 INSERT）都會先進 WAL。CDC 讀的是 WAL，所以 outbox 的 rows 自然會流出來。兩者是上下層：outbox 是 app 層設計的表，WAL 是它流出 DB 的通道。

## 直接 CDC 業務表不就好了？

看下游要的是「資料」還是「事件」。下游只要一份資料副本（search index、cache invalidation、進 data warehouse），直接 CDC 業務表就好，outbox 反而多此一舉。跨服務的整合事件才需要 outbox，理由有三：

1. **意圖不見了。** 「下單」一個 transaction 碰五張表，WAL 流出來是五筆互不相干的 row change，下游要自己拼回「有人下單了」。outbox 裡就是一筆 `OrderPlaced`，事件本身就是意圖。
2. **內部 schema 變成對外 API。** 下游直接訂閱 `orders` 表，你 rename 欄位、拆表，所有 consumer 一起故障。outbox 的 payload 是設計過的事件格式，內部怎麼重構都不影響它。
3. **過濾與隱私。** 業務表整 row 流出去，包括成本價、個資這些下游不該看的欄位。outbox 只放你決定給的。

兩條路都靠 WAL 流出 DB，差在讓下游看到哪一層。
