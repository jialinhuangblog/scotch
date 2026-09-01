---
title: "IXP (Internet Exchange Point)"
slug: ixp
brief: "AS 之間直接互連的實體交換中心，不經 transit 省錢省延遲。"
article: routing-journey
date: 2026-04-10
---

# IXP (Internet Exchange Point)

AS 之間要交換流量，最直覺的方式是透過 transit provider：付錢給大型 ISP，讓它幫你轉。但流量大了之後，transit 費用高、繞路多、延遲大。

IXP 解決這個問題：一個實體機房，多個 AS 把 router 接進來，直接互連。

## 沒有 IXP 的世界

```text
AS-A (台灣小型 ISP)
  │
  │ 付費 transit
  ▼
AS-B (國際 transit provider)
  │
  │ 付費 transit
  ▼
AS-C (內容提供商)
```

A 要到 C，經過 B 轉兩次。A 和 C 都付 transit 費給 B。

## 有 IXP 的世界

```text
┌─────────── IXP ───────────┐
│                           │
│  AS-A ─── switch ─── AS-C │
│                           │
└───────────────────────────┘
```

A 和 C 都接進同一個 IXP，透過 BGP 建立 peering。流量直接走，不經 transit。雙方省錢、延遲更低。

## Peering vs Transit

| | Peering (IXP) | Transit |
|---|---|---|
| 費用 | 通常免費（settlement-free）或低費用 | 按流量計費 |
| 路由 | 只交換彼此的路由 | 拿到對方的完整路由表 |
| 適用 | 兩個 AS 之間有大量直接流量 | 需要連到整個網際網路 |

大型 CDN（Cloudflare、Akamai）在全球各地 IXP 都有 presence，這是它們延遲低的原因之一。

## 規模

全球超過 1,000 個 IXP。TWIX（台灣）、HKIX（香港）、DE-CIX（法蘭克福，全球數一數二大，2025 年單站尖峰流量破 18 Tbps）。一個 IXP 可能有數百個 AS 接入。

---

## References

- [DE-CIX Frankfurt 流量統計](https://www.de-cix.net/en/locations/frankfurt/statistics) — 單站尖峰流量
- [Internet Society Pulse：全球 IXP 數量統計](https://pulse.internetsociety.org/en/blog/2025/06/counting-ixps-and-ixp-databases/)
