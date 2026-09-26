---
title: "Server-Sent Events"
slug: sse
brief: "一條 GET 不關，server 用 text/event-stream 一直往下寫。單向推送，瀏覽器原生自動重連，就是普通 HTTP。"
date: 2026-04-28
article: http-realtime-pushing
---

# Server-Sent Events

> Server 想推資料給 client，但又不想升級成 WebSocket。有沒有更便宜的做法呢？

## 場景

最典型的是通知系統：server 有新 notification 要推給瀏覽器，資料量不大，而且只往一個方向走，client 不需要回話。WebSocket 是雙向的，但這裡只需要 server 單向推，用它多了一堆用不到的功能；long polling 每收完一次就得重發一次 request，每則通知都多一次 request 往返。

## 機制：不結束的 HTTP response

Client 開一條普通 GET：

```text
GET /events HTTP/1.1
Accept: text/event-stream
```

Server 回 200 + 一個**永遠不收尾的 response body**：

```text
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache

data: 第一筆訊息

data: 第二筆訊息

data: 第三筆訊息
... (連線一直開著，server 想推就推)
```

每筆訊息以 `data:` 開頭，空行分隔。靠 HTTP/1.1 的 **chunked transfer encoding**，server 不用事先知道整個 response 多大。

## 瀏覽器 API

```ts
const es = new EventSource('/events');
es.onmessage = (e) => console.log(e.data);
es.onerror = () => console.log('reconnecting...');
```

`EventSource` **原生支援自動重連**。網路斷了，瀏覽器會自己重連並帶上 `Last-Event-ID` header，server 從上次推完的位置接著送。

WebSocket 沒這個自動機制，要自己寫 retry。

## 連線佔用

| | HTTP/1.1 | HTTP/2 |
|---|---|---|
| SSE 佔多少 | 6 條 per-origin pool 中的 1 條 | 一條 TCP 上的 1 個 stream |
| 多開幾個分頁各連 SSE | 每分頁吃 1 條，剩餘 pool 變少 | 共用 TCP，幾乎不影響其他 request |

[HTTP/2](chunk://http2) 下 SSE 變得很便宜，這是 SSE 近年又常被採用的原因之一。

## SSE vs WebSocket vs Polling

|  | SSE | [WebSocket](chunk://websocket) | Long Polling |
|---|---|---|---|
| 方向 | 單向 server→client | 雙向 | 單向（模擬） |
| 協議 | 純 HTTP | HTTP 握手後升級 | 純 HTTP |
| 自動重連 | 原生 | 自己寫 | 每輪自動重發 |
| 防火牆 / proxy | 全通（就是 HTTP） | 可能被擋 | 全通 |
| Server 寫法 | 寫 response stream | 升級協議 + frame | hold connection |
| 適合 | 通知、股票報價、build log、LLM stream | 聊天、遊戲、協作 | 其他方式都不通時的相容退路 |

## 適用場景

- **通知中心**：server 推、client 不主動回 → SSE
- **股票報價、即時 dashboard**：單向、量大、走純 HTTP 不會被 proxy 擋 → SSE
- **OpenAI / Claude API streaming**：LLM 一個一個 token 送回來，標準是 SSE
- **build log、CI 狀態**：server 陸續輸出 → SSE
