---
title: "Idempotency"
slug: idempotency
brief: "同一個請求送兩次，結果一樣。沒有 idempotency key，重試就會變成重複執行。"
date: 2026-03-21
updated: 2026-07-20
revisions: 2
---

# Idempotency

> API 和分散式系統的安全重試基礎。同一個操作執行一次和執行多次，結果一樣。

## 為什麼需要冪等

Client 送了一個扣款請求，server 處理完了，但 response 在網路上丟了。

```text
Client → POST /payments {amount: 100} → Server (扣了 100)
Client ← timeout (response 沒收到)
```

Client 不知道 server 到底有沒有處理。最安全的做法是重送。但如果 server 又扣了 100，用戶被扣了 200。

重試是分散式系統的基本生存策略。沒有冪等，重試就可能重複扣款、重複下單。

## HTTP 方法的冪等性

HTTP spec 定義了哪些方法是冪等的：

```text
GET    /users/1              → 冪等（讀幾次都一樣）
PUT    /users/1 {name: "A"}  → 冪等（覆蓋成同一個值）
DELETE /users/1              → 冪等（刪一次和刪十次，結果都是不存在）
POST   /payments             → 不冪等（每次都可能建立新記錄）
```

GET、PUT、DELETE 天生冪等。問題出在 POST。

## Idempotency Key

讓不冪等的操作變冪等，最常見的做法是 idempotency key。

Client 在 request header 帶一個唯一的 key（通常是 UUID）。Server 第一次處理時，把 key 和結果存起來。同一個 key 再來，直接回傳之前的結果，不再執行。

```text
第一次：
POST /payments
Idempotency-Key: abc-123
{amount: 100}
→ Server 扣款 100，儲存 {abc-123: {status: success, id: pay_001}}
→ 回傳 201 Created

第二次（重試）：
POST /payments
Idempotency-Key: abc-123
{amount: 100}
→ Server 查到 abc-123 已處理過
→ 直接回傳 201 Created {id: pay_001}，不再扣款
```

Stripe 的 API 就是這樣設計的。每個 POST request 都可以帶 `Idempotency-Key` header。

## Server 端怎麼實作

```text
收到 request + idempotency key
  ↓
查 key 是否存在
  ├─ 存在 → 回傳之前的 response（不執行 business logic）
  └─ 不存在 → 執行 business logic → 儲存 key + response → 回傳
```

關鍵細節：

**儲存在哪？** Redis 加 TTL（例如 24 小時）。Key 不需要永久保存，只要覆蓋 retry 的時間窗口。

**Race condition？** 兩個相同 key 的 request 同時到達。用 Redis `SET NX`（只在 key 不存在時寫入）或 DB 的 unique constraint 當鎖。先搶到的執行，後到的等結果或回傳 409 Conflict。

**儲存什麼？** 不只是「已處理」的 flag，而是完整的 response（status code + body）。這樣重試拿到的結果和第一次完全一樣。

## Kafka 場景：同原理

API 場景是 client 主動帶 idempotency key。Kafka 場景不一樣：consumer 自己從消息內容裡挑一個欄位（例如 order_id）當 dedup key，處理過的就跳過。Kafka 的 exactly-once 語義背後也是同一個原理：producer 帶 sequence number，broker 發現重複的 sequence 就丟棄。不管哪種，核心都是讓接收端記得「這個我已經處理過」。

## 常見陷阱

**Key 由誰產生？** 一定是 client。如果 server 產生，client 重試時拿不到同一個 key。

**Key 的作用域？** 通常綁定到 user + operation type。同一個 user 的兩筆不同付款，key 不同。同一筆付款的重試，key 相同。

**過期時間？** 太短，retry 時 key 已過期，又執行了一次。太長，浪費儲存空間。Stripe 用 24 小時。

---

冪等讓重試安全。Idempotency key 是最通用的實作：client 帶 key，server 記住處理過的結果，同一個 key 不再執行。
