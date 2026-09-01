---
title: "Aggregate Root"
slug: aggregate
brief: "aggregate 是守 invariant 的 entity 群組，沒有要守的 invariant 就不需要它。"
article: ddd-textbook-vs-real
date: 2026-06-14
---

# Aggregate Root

把幾個有關係的 entity 圈成一組、用一個 root 當對外唯一入口，目的是守住**不變式（invariant）**，也就是一條永遠都必須成立、資料任何時候都不能違反的規則（例如「一張訂單最多 100 個品項」「已付款的訂單不能改」）。

這是 DDD 八條裡爭議最大的一條，爭兩件事：**要不要用**（大多數 entity 關係根本沒有硬 invariant，硬包成 aggregate 只是徒增複雜度），跟**邊界畫多大**（太大，改一個小欄位都要載入整包、又容易 lock 競爭；太小，又守不住該守的 invariant）。

## 教科書定義

一組 entity 的對外代表。所有對 child entity 的變更必須**經過 root**，不能直接動 child。

經典例子：Order + LineItem

```typescript
class Order {
  private items: LineItem[] = [];

  addItem(item: LineItem): void {
    if (this.items.length >= 100) throw new Error('order full');
    if (this.status === 'paid') throw new Error('cannot modify paid order');
    this.items.push(item);
  }
  // 外部不能直接呼叫 LineItem.persist()
}
```

`Order` 是 aggregate root，`LineItem` 是 child。新增 LineItem 必須走 `order.addItem()`，這樣才能確保「最多 100 筆」「已付款不能改」這些 invariant 不被破壞。

## 實務上為什麼常省略

aggregate 的價值來自 **invariant**。沒 invariant 的時候，做 aggregate 純粹是 ceremony：

- 增加 code 複雜度
- entity 間的關係多一層 abstraction
- repository API 變得受限

很多 entity 對之間**根本沒強 invariant**，例如 Conversation + Message，多數團隊就讓它們平等存在，各自有 repository。

這不是個人偏好。Vaughn Vernon 的 [Effective Aggregate Design](https://www.dddcommunity.org/library/vernon_2011/) 就主張 aggregate 要小：大叢集 aggregate 效能跟 scale 都差，該照業務上真實的一致性約束來圈，不是順著物件關聯圖、圖方便就包。

## 判斷規則

**跨 entity 之間有不變式必須一起守住嗎？**

- 有（「最多 100 筆」「總和不能 > X」「狀態互斥」）→ 做 aggregate
- 沒有 → 不要做，平面 entity 就好

決定不做的話，順手記一下為什麼（寫個 ADR 就行），免得下一個讀過 Evans 的人覺得「這不該漏」又幫你加回來。

---

## References

- [Effective Aggregate Design](https://www.dddcommunity.org/library/vernon_2011/) — Vaughn Vernon, 2011。aggregate 要小、照真實 invariant 圈的經典論述。
