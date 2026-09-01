---
title: "Domain Service"
slug: domain-service
brief: "跨多個 entity 的純業務規則，不屬於任何一個 entity，也不碰 I/O。"
date: 2026-06-14
article: ddd-textbook-vs-real
---

# Domain Service

有些業務規則塞不進任何一個 entity，它牽涉到好幾個 entity，硬塞進其中一個都怪。這種規則就放 Domain Service：一個無狀態、零 I/O（不碰 DB、不碰網路）的純業務 function。

## 什麼時候用

兩個條件：**跨多個 entity** + **只做計算、不碰 I/O**。

電商例子：

- **算運費**：要看重量、目的地、物流商的費率規則。它不屬於 `Order`，也不屬於 `Customer`，放一個 `ShippingFeeService`。
- **判斷訂單符不符合某個促銷**：要同時看 `Order`、`Promotion`、`Customer` 三個。

拿「算運費」舉例，它長這樣，就只是算一算、把結果回傳，不碰 DB：

```typescript
// domain/services/shipping-fee-service.ts（只算，不碰 DB 跟網路）
export class ShippingFeeService {
  calc(cart: Cart, dest: Address): Money {
    const weight = cart.totalWeight();                       // 用傳進來的 entity，自己不去撈
    const base   = weight <= 5 ? 60 : 60 + (weight - 5) * 12; // 重量級距
    const remote = dest.isRemoteArea() ? 100 : 0;            // 偏遠加價
    if (cart.subtotal() >= 1000) return Money.zero();        // 滿千免運
    return Money.of(base + remote);
  }
}
```

`cart` 是別人撈好傳進來的，它不自己查 DB；算完回傳 `Money`，要不要存是 application service 叫 repository 去做。它只負責「運費這條規則怎麼算」這一件事。

## 跟另外兩層分清楚

最容易跟 [Application Service](chunk://application-service) 搞混，差別在**碰不碰 I/O**：

| | 管什麼 | 碰 I/O 嗎 |
|---|---|---|
| entity method | 單一 entity 的行為（`order.addItem()`） | 否 |
| **Domain Service** | 跨 entity 的純業務規則 | **否** |
| Application Service | 撈資料、編排、存回去 | 是 |

Domain Service 只做計算，要存要撈的髒活交給 Application Service。

像會計師算稅：給他數字，他套規則算出答案，但他不負責去倉庫翻單據、也不負責把結果存進系統，那是別人的事。
