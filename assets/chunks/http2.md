---
title: "HTTP/2 Stream Multiplexing"
slug: http2
brief: "一條 TCP 跑多個 stream，frame 交錯送。少握手成本，但 TCP 層丟包會卡到所有 stream。"
date: 2026-04-28
updated: 2026-07-20
revisions: 2
article: browser-connection-reuse
---

# HTTP/2 Stream Multiplexing

> HTTP/1.1 一條 TCP 一次只能送一個 request，所以瀏覽器對同一個 origin 開到 6 條。HTTP/2 用一條，怎麼辦到的？

## 場景

頁面有 50 個資源（CSS、JS、圖片）。HTTP/1.1 下，瀏覽器開 6 條 TCP 排隊送，第 7 個資源要等前面釋放。每條都做 TCP 握手 + TLS 握手，握手成本就是 latency。

```text
HTTP/1.1：
  TCP 1 [conn][TLS][CSS]              [done] [JS]
  TCP 2 [conn][TLS][HTML]      [done][img1]
  TCP 3 ...
  ...
  TCP 6
  資源 7-50 排隊等空閒連線
```

## Stream Multiplexing

HTTP/2 把每個 request 切成 frame，每個 frame 標 stream_id。一條 TCP 上交錯送：

```text
[stream=1, HEADERS][stream=3, HEADERS][stream=1, DATA][stream=5, DATA][stream=3, DATA]
```

50 個資源 = 50 個 stream，全部塞同一條 TCP。**握手只做一次**。CDN、API gateway 都很愛。

## Header Compression（HPACK）

HTTP/1.1 每次都送一份 header，包含 cookie / user-agent / authorization。重複量很大。HPACK 用一張兩端共享的 table，第二次就送 index：

```text
第一次：Authorization: Bearer abc123...    （200 bytes）
第二次：[index 62]                          （1 byte）
```

API 場景下，重複的 header（Authorization、Cookie）幾乎都變成一個 index，跨請求最高省到 ~99%。[Cloudflare 實測](https://blog.cloudflare.com/hpack-the-silent-killer-feature-of-http-2/)整體 request header 平均省下約 76%（response header 約 69%）。


## Connection Coalescing

不同 hostname 解到同一個 IP、cert 的 SAN（Subject Alternative Name）又涵蓋時，瀏覽器會把它們併進同一條 TCP。副作用：HTTP/1.1 時代把資源分散到多個 subdomain 的 domain sharding，在 H2 會被自動併回一條，變成反模式。

## 陷阱：TCP 層的 Head-of-Line Blocking

應用層多工了，傳輸層還是 TCP。**TCP 保證順序**，stream 1 的 packet 丟了，stream 2、3、4 的 packet 都要等：

```text
stream 1 第 5 個 packet 丟掉
  ↓
TCP 收到 stream 2、3、4 的後續 packet 也不交給應用
  ↓
50 個 stream 全部卡住，等重傳
```

HTTP/1.1 反而沒這問題，6 條 TCP 各自獨立，丟包只卡那一條。

**結論：高丟包網路（行動網路、弱 Wi-Fi）下，HTTP/2 可能比 HTTP/1.1 慢。** [HTTP/3 用 QUIC](chunk://http3-quic) 就是為了解這個。

---

HTTP/2 把 6 條 TCP 變 1 條，省掉了握手成本，但把 HOL blocking 從應用層挪到了傳輸層。
