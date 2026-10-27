---
title: "DDD"
slug: ddd
brief: "出自 Eric Evans 的藍皮書。實務上通常保留 strategic 那層，省略部分 tactical pattern。"
article: ddd-textbook-vs-real
date: 2026-06-14
updated: 2026-07-20
revisions: 1
---

# DDD

Domain-Driven Design，一種讓 code 跟著業務走的設計方法。code 裡的名詞用業務的講法，系統的邊界跟業務的邊界一致。它要解的問題是，系統一大，業務規則就散在 controller、service、SQL 之間，改一條規則要翻五個地方，還沒人說得清楚哪份才是對的。Eric Evans 在 2003 把方法整理成一整本書（「Domain-Driven Design: Tackling Complexity in the Heart of Software」，封面藍色，俗稱藍皮書），下面八條概念都出自這裡。

## 八條核心概念

| 概念 | 解什麼 |
|---|---|
| Ubiquitous Language | 業務、code、DB 全用同一套詞，講好「作廢」code 就叫 `void`，中間不翻譯 |
| [Bounded Context](chunk://bounded-context) | 同一個詞在不同 subdomain 意義不同，各自一份 model |
| [Aggregate Root](chunk://aggregate) | entity 群組的代表，負責維護 invariant |
| [Repository](chunk://repository-pattern) | domain 定義介面，infra 提供實作 |
| [Domain Service](chunk://domain-service) | 純業務 function，零 I/O |
| [Application Service](chunk://application-service) | 編排 domain service + repository |
| [Domain Event](chunk://domain-event) | 業務事件用 event 傳遞 |
| [Anti-Corruption Layer](chunk://anti-corruption-layer) | 跟外部系統的翻譯層 |

## 教科書 vs 實務

一開始會想當然全部照做，但實務久了就知道哪些不好用，然後拿掉特定 2、3 條，就像寫 React 久了會說「少用 useEffect」。

拿掉哪幾條不是憑感覺。DDD 實務的共識是：**strategic 那層（[Bounded Context](chunk://bounded-context)、Ubiquitous Language）要留**。tactical pattern 都是在某個 Bounded Context 裡面套用的，沒有這層，就不知道 aggregate、repository 要套在哪個範圍。真正常被省略或簡化的是 **tactical** 那群，沒有正當理由通常不用：

- [Aggregate](chunk://aggregate)：沒有真的 invariant 就別包（[Vaughn Vernon](https://www.dddcommunity.org/library/vernon_2011/) 主張 aggregate 要小，大叢集效能差）
- Domain Event / Event Sourcing：過度使用是公認的 anti-pattern
- 完整 [Repository](chunk://repository-pattern)：很多團隊直接用 ORM 就夠

不做的條目通常會記成一份 ADR（Architecture Decision Record）寫下理由，不然下一個讀過 Evans 的人很容易又把它改回來。
