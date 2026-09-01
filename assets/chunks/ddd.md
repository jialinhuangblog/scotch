---
title: "DDD"
slug: ddd
brief: "出自 Eric Evans 的藍皮書，一整套概念，當然實務上總是會漏東漏西的。"
article: ddd-textbook-vs-real
date: 2026-06-14
updated: 2026-07-20
revisions: 1
---

# DDD

Domain-Driven Design，一種讓 code 跟著業務走的設計方法：code 裡的名詞照業務的講法取，系統的邊界照業務的邊界切。它要解的問題是，系統一大，業務規則就散在 controller、service、SQL 之間，改一條規則要翻五個地方，還沒人說得清楚哪份才是對的。Eric Evans 在 2003 把方法整理成一整本書（「Domain-Driven Design: Tackling Complexity in the Heart of Software」，封面藍色，俗稱藍皮書），下面八條概念都出自這裡。

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

一開始會想當然全部照做，但實務久了就知道哪些不好用，然後拿掉特定 2、3 條，就像寫 React 久了會說「少用 useEffect」。架構師做的事，就是決定哪幾條可以省略、而且講得出理由。

拿掉哪幾條不是憑感覺。DDD 實務的共識是：**strategic 那層（[Bounded Context](chunk://bounded-context)、Ubiquitous Language）是地基，要留**。沒有它們，下面的 tactical pattern 全失去意義。真正常被省略或簡化的是 **tactical** 那群，沒正當理由就別硬上：

- [Aggregate](chunk://aggregate)：沒有真的 invariant 就別包（[Vaughn Vernon](https://www.dddcommunity.org/library/vernon_2011/) 主張 aggregate 要小，大叢集效能差）
- Domain Event / Event Sourcing：過度使用是公認的 anti-pattern
- 完整 [Repository](chunk://repository-pattern)：很多團隊直接用 ORM 就夠

哪幾條不做，順手寫一下為什麼（記成一份 ADR），不然下一個讀過 Evans 的人很容易又把它改回來。
