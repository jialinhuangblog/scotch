---
title: "WebSocket"
slug: websocket
brief: "HTTP 升級成雙向通道。聊天、遊戲、協作編輯的標準解。"
date: 2026-03-21
updated: 2026-07-20
revisions: 2
article: http-realtime-pushing
---

# WebSocket

> HTTP 是 client 問 server 答。聊天室要 server 主動推、client 也要傳，怎麼辦？

## HTTP 的限制

```text
HTTP request-response：
  Client: GET /messages → Server: 200 [...]
  （連線通常關閉，下次再要重新發 request）
```

[Long polling](chunk://long-polling) 跟 [SSE](chunk://sse) 解了「server 主動推」這一半，但都是單向。聊天室、遊戲、協作編輯需要**雙向**。

## WebSocket：升級協議

Client 用一個 HTTP request 開頭，加 `Upgrade: websocket` header。Server 回 `101 Switching Protocols`，**這條 TCP 從此不再是 HTTP**：

```text
GET /chat HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==

HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=

（後續所有資料都是 WebSocket frame，雙向隨時送）
```

借用 HTTP 握手是為了**穿過 firewall 跟 proxy**，它們認識 HTTP，但不認識憑空的 WebSocket。升級完成後就不再受 HTTP 規則限制。

## 雙向 frame

```text
B → {"type":"msg", "text":"hello"}
B ← {"type":"msg", "from":"A", "text":"hi"}
B ← {"type":"typing", "from":"C"}
B → {"type":"msg", "text":"ok"}
```

WebSocket frame header 只有 2-14 bytes，比 HTTP 的 header 量小很多。**高頻訊息場景省 bandwidth**。

> 範圍從 2 變 14 是因為長度欄位用 [variable-length encoding](chunk://varint-encoding)（≤125 用 7 bit、≤64KB 多 2 bytes、更大多 8 bytes），加上 client 送出時要額外 4 bytes masking key 防 cache 攻擊。常見 case 付最少 overhead。

[HTTP/2](chunk://http2) 下，WebSocket 用 CONNECT 方法走一個 stream（RFC 8441），不再佔住整條 TCP；server / 瀏覽器都支援才會走這條，否則自動降回 HTTP/1.1。

## 代價

**Stateful connection**。每條 WebSocket 綁定一台 server。Server 重啟、scale-out、deploy，連線斷開，client 要重連。Load balancer 要 sticky session 或 L7 支援。

**不能用 HTTP 工具鏈**。CDN、cache、API gateway、middleware 大多基於 HTTP request/response model，WebSocket 不是 request/response，不能直接套。

**連線數成本**。10 萬條 WebSocket = 10 萬個 TCP 常駐記憶體。每條幾 KB，但 OS file descriptor 上限要調。

**沒原生重連**。[SSE](chunk://sse) 的 EventSource 自動重連，WebSocket 要自己寫 retry + 還原狀態。

## 怎麼選

|  | 場景 |
|---|---|
| [Short polling](chunk://long-polling) | 量低、要極簡兼容 |
| [Long polling](chunk://long-polling) | proxy 嚴格、其他都不通 |
| [SSE](chunk://sse) | 單向 server→client（通知、stream log、LLM token） |
| **WebSocket** | 雙向（聊天、遊戲、協作、白板） |

## 實務架構

10 萬條 WebSocket 不該由 application server 直接管。常見：

```text
Client ↔ WebSocket Gateway ↔ Message Broker（Kafka / Redis Pub-Sub）↔ App Server
```

Gateway 只管連線跟轉發，business logic 在 App Server。**App Server 維持無狀態，可以隨意 scale**。這樣一來，「連線必須綁在固定一台機器上」這個 stateful 的麻煩只留在 Gateway 那一層，不會擴散到後面的 App Server。

---

WebSocket 用一次 HTTP 握手換成雙向 TCP 通道。代價是 stateful、HTTP 工具鏈用不上、連線數要管。雙向需求才用，單向走 [SSE](chunk://sse) 比較省。
