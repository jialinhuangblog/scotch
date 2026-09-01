---
title: "CDN Caching"
slug: cdn-caching
brief: "邊緣快取。Push vs pull。Invalidation 傳播延遲。"
date: 2026-04-07
---

# CDN Caching

用戶在東京，server 在美西。每個 request 來回 150ms。加了 CDN，東京的邊緣節點有快取，來回 5ms。

CDN 是 read-through cache 的大規模版本。邊緣節點 miss 了，自己回源站拿，快取起來，下次直接回。Application 不需要知道 CDN 的存在。

## Pull vs Push

**Pull CDN**：第一個用戶 request 到邊緣節點，miss，節點回源站拿，快取起來。之後的 request 命中。大部分 CDN 的預設模式。

```text
用戶 → 邊緣節點（miss）→ 源站 → 邊緣節點（快取）→ 用戶
用戶 → 邊緣節點（命中）→ 用戶
```

缺點：第一個用戶一定慢。流量低的內容可能 TTL 過期後又要重新拉。

**Push CDN**：你主動把內容推到邊緣節點。不等 request。適合大型靜態資源（影片、firmware），或發布前就知道會爆流量的內容。

大部分場景用 pull。Push 只在你能預測流量的時候才值得。

## Cache-Control

CDN 看 HTTP header 決定要不要快取、快取多久：

```text
Cache-Control: public, max-age=86400        → CDN 快取 24 小時
Cache-Control: private, no-store             → CDN 不快取（個人化內容）
Cache-Control: public, s-maxage=3600         → CDN 快取 1 小時（s-maxage 優先於 max-age）
```

`s-maxage` 是給 shared cache（CDN）看的。`max-age` 是給瀏覽器看的。兩個可以設不同值：CDN 快取 1 小時，瀏覽器快取 5 分鐘。

## Invalidation

CDN 最難搞的地方。內容更新了，所有邊緣節點的舊快取怎麼清？

| 方法 | 做法 | 代價 |
|---|---|---|
| TTL 過期 | 等 max-age 到期自然更新 | 更新有延遲，TTL 內是 stale |
| 主動 purge | API 呼叫 CDN 清除特定 URL | 傳播到所有節點要幾秒到幾分鐘 |
| 版本化 URL | `app.v2.js` 或 `app.abc123.js` | 新 URL = 新快取，舊的自然過期。最乾淨 |

版本化 URL 是最可靠的做法。前端 build tool 產生的 hash filename（`main.3f2a1b.js`）就是這個原理。HTML 本身設短 TTL 或不快取，CSS/JS 用 hash filename + 長 TTL。

## CDN 處理不了的情況

- 動態 API response（個人化內容、即時資料）
- POST/PUT/DELETE（寫入操作）
- 低流量的長尾內容（快取命中率低，不如不快取）

CDN 解決的是「同一份內容被大量人讀」。如果每個 request 的 response 都不一樣，CDN 幫不上忙。
