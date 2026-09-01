---
title: "Application Service"
slug: application-service
brief: "一個 use case 的入口跟指揮：決定先做什麼、再做什麼，把 domain 邏輯、repository、event 串成一次完整操作，本身不放業務規則。"
date: 2026-06-14
article: ddd-textbook-vs-real
---

# Application Service

一個 use case 的入口（例如「下單」）。它負責**編排**一次完整操作，但**自己不放業務規則**。規則在 entity 跟 [Domain Service](chunk://domain-service) 裡，它只是把它們串起來、加上 I/O。

## 一次下單長怎樣

```text
PlaceOrderService.execute(cmd):
  cart  = cartRepo.getById(cmd.cartId)       // 讀（I/O）
  fee   = shippingFeeService.calc(cart)      // 呼叫 domain 邏輯（只算，不碰 I/O）
  order = Order.create(cart, fee)            // entity 行為
  orderRepo.save(order)                      // 存（I/O）
  events.publish(new OrderPlaced(order.id))  // 發事件
```

它做的 I/O（讀寫資料、發 event）到處都有，但只有它**知道這個 use case 該怎麼跑**：先讀什麼、呼叫哪個 domain 邏輯、何時存、最後發什麼 event，而且這整段算一個 transaction。它不算業務規則（在 domain service 跟 entity）、也不自己存資料（在 repository），但它是唯一知道「下單 = 這幾步、這個順序」的地方。少了它，這個順序就沒有任何一層記著，呼叫端只好自己拼。

## 跟 Domain Service 分清楚

這兩個最容易混：

- [Domain Service](chunk://domain-service)：**純業務規則，零 I/O**。
- **Application Service**：**編排 + I/O，零業務規則**。

像樂團指揮：Application Service 是指揮，自己不演奏任何樂器，但決定誰先進、誰後進、整首怎麼跑；[Domain Service](chunk://domain-service) 是樂手，只負責把自己那段演奏好，不管整體調度。
