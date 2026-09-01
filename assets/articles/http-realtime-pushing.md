---
title: "Server 只會回答、不會主動找你，那 realtime notify 怎麼做到"
slug: http-realtime-pushing
subtitle: "從 HTTP/1.1 的六條連線，到 WebSocket 偷偷升級協議。每一步都在繞同一個限制。"
chapter: "realtime"
tags: [http, http2, http3, websocket, sse, polling]
date: 2026-04-28
related: [message-system-axes, webrtc-nat-traversal, why-udp, why-xmpp]
---

# Server 只會回答、不會主動找你，那 realtime notify 怎麼做到

HTTP 從 1989 年就定下基調：**client 問，server 答**。Server 沒辦法主動發話。可是聊天室、通知中心、股票行情、Google Doc 協作，這些都得「server 有新資料就推給 client」。

四十年來工程師繞這個限制繞出一整套技術。每多一層，都是因為前面那層有缺。這條因果鏈走完，notification system / chat system / live dashboard 該選哪個，自己就推得出來。

```text
HTTP 一問一答
  → Polling 客戶端一直問（浪費）
    → Long Polling 問了你不要急著回（hold connection）
      → SSE 一條 GET 永遠不關（單向 stream）
        → WebSocket 借 HTTP 握手後升級成雙向 TCP
          → Socket.IO 兜底相容性（先 long-poll 再升級）
```

但這只是「應用層」的故事。底下還有「傳輸層」的故事，HTTP/1.1 → /2 → /3 也在解一連串 connection 跟 multiplexing 的問題，跟上面那條鏈交錯影響。

---

## HTTP/1.1：6 條 TCP 是上限

瀏覽器對同一個 origin 最多開 **6 條 TCP**（Chrome / Firefox 預設）。不是一次開 6 條，是看需求動態開。每條連線用 keep-alive 連續傳多個資源。

```text
資源 1 → 開連線 1
資源 2 → 連線 1 還在忙 → 開連線 2
資源 3 → 連線 1、2 都忙 → 開連線 3
資源 4 → 連線 1 剛傳完 → 複用
資源 7 → 沒空閒 → 等
```

每條連線**一次只傳一個資源**。資源 A 傳完才能傳 B，這叫 **head-of-line blocking**（per connection）。50 個資源同時要載入，前 6 個有路走，後 44 個排隊。

工程師早期繞這個的方式是 **domain sharding**，把資源故意分散到 5 個 subdomain：

```text
your-site.com  → 6 條
cdn-a.com      → 6 條
cdn-b.com      → 6 條
cdn-c.com      → 6 條
cdn-d.com      → 6 條
共 30 條
```

代價是每個 subdomain 都要做 DNS 解析、TCP 握手、TLS 握手。HTTP/2 之後 sharding 變成反模式，多餘握手反而慢。

---

## HTTP/2：一條 TCP 跑多 stream

[HTTP/2](chunk://http2) 把每個 request 切成 frame，每個 frame 標 stream_id。一條 TCP 上交錯送：

```text
[stream=1, HEADERS][stream=3, HEADERS][stream=1, DATA][stream=5, DATA][stream=3, DATA]
```

50 個資源 = 50 個 stream，全部塞同一條 TCP。**握手只做一次**。HPACK 順便壓縮重複 header（Authorization、Cookie 第二次只送 index）。

跨分頁也會共用：兩個分頁連到同個 origin，瀏覽器把它們合併到同一條 TCP 上。Connection coalescing 更狠，不同 hostname 如果證書 SAN 涵蓋且 DNS 解到同一 IP，瀏覽器把它們也合併到同一條 TCP（RFC 7540 §9.1.1）。CDN 故意這樣部署吃這個優化。

### 但下面還是一條 TCP：一個包丟了，全部 stream 一起卡（隊頭阻塞）

應用層多工了，下面**還是一條 TCP**。TCP 保證順序：

```text
stream 1 第 5 個 packet 丟掉
  → TCP 收到 stream 2、3、4 的 packet 也壓在 buffer 裡不交給應用
    → 200 個 stream 全卡，等 stream 1 重傳
```

HTTP/1.1 反而沒這問題。6 條 TCP 各自獨立，丟包只卡那一條。所以**高丟包網路（行動網路、弱 Wi-Fi）下，HTTP/2 可能比 HTTP/1.1 慢**。

---

## HTTP/3：把 stream 推到傳輸層

問題在 TCP 不認識 stream。想根治得換傳輸層。

[HTTP/3](chunk://http3-quic) 用 QUIC，一個跑在 UDP 上的新傳輸層。QUIC 自己重做了可靠傳輸、congestion control、ordering，**但是 per-stream**。stream 1 丟包，stream 2、3、4 繼續跑，互不干擾。

為什麼建在 UDP 上不在 TCP 旁？兩個原因：TCP 在 OS kernel 裡，改不動；中間 box（NAT、防火牆）只認 TCP / UDP，發明新 protocol 過不了路。UDP 是最薄的「我就是要送 packet」protocol。kernel 為何改不動、TCP 跟 UDP 的 pseudo code 對照，見 [HTTP/3 over QUIC](chunk://http3-quic)。

```text
HTTP/1.1 → 多條 TCP，各自 HOL，丟包只卡那一條
HTTP/2   → 一條 TCP，應用層多工，TCP 層還是 HOL
HTTP/3   → 一條 QUIC over UDP，傳輸層 stream 獨立
```

額外送的：QUIC 用 connection ID 認連線，IP 換了照常用。**手機從 Wi-Fi 切 4G 不會斷**，YouTube 跨網路繼續播是這個。

---

## 應用層：Polling / SSE / WebSocket 在解什麼

傳輸層演進處理「怎麼讓 N 個 request 共用一條 TCP」。但 server 主動推這件事，HTTP 本身就沒設計。下面這條鏈是應用層繞限制的歷程。

### Short Polling：其實只是定時重發

Client 用迴圈每 5 秒 fetch 一次：

```ts
setInterval(() => fetch('/messages'), 5000);
```

Server 收到立刻回。沒新資料就回空 array。「short polling」這個名字只是為了跟 long polling 對比，做的事就是 **client 端用瀏覽器的 `setInterval` 計時器，每隔幾秒重發一個普通 HTTP request**，server 跟協議層都沒做任何特別處理。

問題：1000 個 user 每 5 秒問一次 = 200 req/s 多半空回應。延遲也差，最壞要等一整輪才看到。量小可以用，大規模不能。

### Long Polling：server 故意不回

Client 發一個 request，**server hold 住**，等有新資料或 timeout 才回。這才是真的「做了什麼」：

```ts
app.get('/messages', async (req, res) => {
  const msg = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 30_000);
    eventBus.once(`user:${req.userId}:new-message`, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
  res.json(msg ?? { empty: true });
});
```

Server 要維護「正在等待的 requests」狀態，要靠 non-blocking I/O + pub/sub 才扛得住量。10 萬 user 同時 hold = 10 萬條 TCP 在 server 開著。詳見 [long-polling chunk](chunk://long-polling)。

最大的優點是**它就是 HTTP**。任何 firewall、proxy、HTTP/1.0 都跑得起來。Socket.IO 的 fallback 就是 long polling — 先確保連得上，能升級才升級。

### SSE：response 永遠不關

Long polling 每次回完就斷，下一輪重連。SSE 的升級是**連線不關，server 一直往下寫**：

```text
GET /events
  ↓
HTTP/1.1 200 OK
Content-Type: text/event-stream

data: 第一筆訊息

data: 第二筆訊息

data: 第三筆訊息
（永遠寫不完的 response）
```

`Content-Type: text/event-stream` 是 SSE 專用格式。需要 HTTP/1.1 的 chunked transfer encoding，server 不用事先知道整個 response 多大。瀏覽器用 `EventSource` API 接收：

```ts
const es = new EventSource('/events');
es.onmessage = (e) => console.log(e.data);
```

**SSE 原生支援自動重連**。瀏覽器斷線會自動重試並帶上 `Last-Event-ID` header，server 從上次推完的位置繼續。WebSocket 沒這個自動機制，要自己寫。詳見 [SSE chunk](chunk://sse)。

### WebSocket：升級成雙向

SSE 單向，聊天室需要雙向。WebSocket 借一個 HTTP 握手，把 TCP 升級成完全不同的協議：

```text
GET /chat HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==

HTTP/1.1 101 Switching Protocols

（從此不再是 HTTP，變成 WebSocket frame 雙向傳）
```

借用 HTTP 握手是為了穿過 firewall 跟 proxy（它們認識 HTTP）。升級完成後就不再受 HTTP 規則限制。WebSocket frame header 只有 2-14 bytes，比 HTTP 的 header 量小很多，高頻訊息場景省 bandwidth。詳見 [WebSocket chunk](chunk://websocket)。

---

## 傳輸層 × 應用層交叉影響

Polling / SSE / WebSocket 跑在哪個 HTTP 版本上，連線佔用方式完全不同：

| | HTTP/1.1（6 條 pool） | HTTP/2（1 條 TCP，N stream） |
|---|---|---|
| Short polling | 每輪借一條 keep-alive | 一個 stream，回完釋放 |
| Long polling | 每輪 hold 一條 | 一個 stream，hold 住 |
| SSE | **持續佔 1 條** | **持續佔 1 個 stream** |
| WebSocket | **整條 TCP 被佔** | **RFC 8441 用一個 stream 跑 WebSocket** |

HTTP/1.1 下 SSE 跟 WebSocket 都會吃掉 6 條 pool 中的一條。多開幾個分頁、再加一些通知的 SSE，pool 馬上就吃光，正常 API request 排隊。

[HTTP/2](chunk://http2) 下這個壓力消失。SSE 變得很便宜（一個 stream），WebSocket 也透過 RFC 8441 的 CONNECT method 跑在一個 stream 上。Server 跟瀏覽器都支援才會走，否則自動降回 HTTP/1.1 做握手，不用寫 code。**SSE 在 HTTP/2 後復興**就是這個原因。

### SSE 佔的是幾號 stream

`stream_id` 是 frame header 裡的一個整數，client 開 request 時自己遞增分配，client 開的一律奇數（1、3、5…），server push 才用偶數。SSE 沒有專屬號碼，跟圖片、API 呼叫排同一列，誰先開誰拿小的：頁面先載 HTML、CSS、JS，等 JS 跑起來才 `new EventSource()`，那條可能是 stream 9。

號碼開好就不再變，關掉也不回收給別人。斷線重連時 `EventSource` 是重發一個新 request，拿到更大的新號，時間軸上是 9 → 27，同時活著的還是只有一個。要同時看到兩個號碼，得是頁面開了兩個 `EventSource`（`/notifications` 一個、`/prices` 一個）。

---

## gRPC 為什麼強制 HTTP/2

[gRPC](chunk://grpc-http2) 強制綁 HTTP/2。它需要的東西 HTTP/1.1 一個都做不出來：

- **Stream**：bidirectional streaming call 要傳輸層級的雙向 stream
- **Trailers**：每個 call 的最終狀態（`grpc-status`）放在 HTTP/2 的 trailing header 送，HTTP/1.1 的 trailer 幾乎沒人支援
- **Header compression（HPACK）**：每個 RPC call 的 metadata 重複很多
- **Multiplexing**：一條連線多個 call

但 RPC 本身不綁 HTTP/2。RPC（Remote Procedure Call）是概念，1980 年代就有：

| Framework | Transport |
|---|---|
| ONC RPC（1984） | TCP / UDP |
| CORBA | IIOP over TCP |
| Java RMI | JRMP over TCP |
| SOAP / XML-RPC | HTTP/1.0 / 1.1 |
| **gRPC** | **HTTP/2** |
| Cap'n Proto RPC | 多種 transport |

講「RPC」要區分：是泛指概念，還是特指 gRPC。

瀏覽器跑不了原生 gRPC（fetch 拿不到 HTTP/2 stream / trailer / binary frame），所以有 **gRPC-Web**，靠 Envoy 之類的 proxy 在 server 側翻譯回真 gRPC。

---

## 實際選型

### Notification System

| 需求 | 建議 |
|---|---|
| Online 用戶推通知 | [SSE](chunk://sse)。HTTP/2 下零連線成本，原生自動重連 |
| Offline 用戶收通知 | 存進 per-user 通知 store，上線後 client 拉未讀 |
| 跨設備同步已讀狀態 | pub/sub + 每設備一條 SSE |
| 通知量爆炸 | Kafka [fan-out](chunk://fan-out) + worker 寫 per-user queue |

**離線 / 關閉時怎麼收：** 頁面開著就用你自己的 SSE/WebSocket 直接推；頁面關了，走 **Web Push + Service Worker**：

1. 你 server 把通知 POST 給**瀏覽器廠商的 Push Service**（Chrome 走 Google 的 Firebase Cloud Messaging、Firefox 走 Mozilla 的 autopush、Safari 走 Apple Push Notification service），不是連瀏覽器。拿到 HTTP 201 就交棒完成，server 之後掛掉也不影響送達。
2. 那條「裝置 ↔ Push Service」長連線由**瀏覽器 / 作業系統**維護（一個瀏覽器共用一條，不是每個網站各一條）。裝置在線就即時送下去；離線時訊息**存在 Push Service 的雲端**（Google / Mozilla / Apple 的伺服器，而且是它也解不開的加密 blob），**不在你裝置上**。你裝置離線期間根本還沒收到它，所以才沒跳通知，要等重連 Push Service 才補送。訊息放超過存活時間（Time To Live，Firebase Cloud Messaging 預設約四週）就直接丟掉。
3. 瀏覽器收到 push → 叫醒**平常睡著的 Service Worker** → 它跑一小段：`showNotification()` 跳系統通知、把資料寫進 IndexedDB → 跑完又被殺掉。

這條鏈是 **best-effort**（會掉訊息、不能重播）。Push Service 等於瀏覽器廠商託管、每台裝置一條的通知佇列，跟手機 app 用的那套（Apple Push Notification service、Firebase Cloud Messaging）同一個角色。

### Chat System

| 需求 | 建議 |
|---|---|
| 1:1 / group 即時訊息 | [WebSocket](chunk://websocket)。需要雙向 |
| 相容性兜底 | [Long polling](chunk://long-polling) fallback（Socket.IO 自動降級） |
| Presence（誰在線） | 另一條 pub/sub + heartbeat |
| Typing indicator | 直接走 WebSocket，不進持久化 |

### LLM streaming（OpenAI / Claude API）

純單向、量大、proxy 友善 → SSE 是業界標準。Anthropic、OpenAI 的 streaming response 都走 SSE，不是 WebSocket。

### Live Dashboard / 股票報價

單向、低頻 → SSE。雙向（用戶能下單）→ 後端拆兩條：SSE 推報價，REST 下單，比一條 WebSocket 包全部簡單。

---

## 決策場景

你是一家中型 SaaS 的後端 lead。產品要新增「即時通知中心」 — user 在系統內被 @ 提到、被指派任務、收到評論時，網頁 icon 要立刻有紅點。

第一直覺：WebSocket，畢竟「即時」嘛。但實際盤點需求：

- **單向**：server 推，client 不需要回任何東西
- **量低**：每個 user 一天平均 20 條通知，不是聊天頻率
- **要簡單**：團隊只有一個 backend，不想另外維護 WebSocket gateway

決策：**SSE**。理由：
1. 後端用現有 Express server 就能寫，不用拆 gateway
2. CDN、API gateway、middleware 全部能繼續用（SSE 就是 HTTP）
3. 原生自動重連 — 不用為了「斷線怎麼辦」寫 code
4. HTTP/2 下零連線成本

上線半年，產品要加「協作白板」 — 多 user 同時編輯。這時才升級成 WebSocket，獨立部署 gateway。**通知中心不動，繼續走 SSE**。

### Regret condition

SSE 適合 server→client 單向。但有個邊界：如果哪天「通知」要加上「按鈕快速回覆」（例如評論直接在通知內回），雙向 traffic 會出現。這時兩條路：
1. 通知還是 SSE，回覆走另一個 REST endpoint（最簡單）
2. 全面換 WebSocket（投資 gateway 基礎建設）

如果 80% 通知不需要互動，繼續 SSE + 額外 REST。20% 互動就要全 WebSocket，那是另一筆 infra 投資。**用「互動比例」決定，不要用「即時」這個含糊的需求決定**。

---

## 串成一條因果鏈

```text
HTTP 是 client 問 server 答
  ↓
HTTP/1.1 一條 TCP 一次只送一個 request
  → 開 6 條繞、domain sharding 繞
    ↓
HTTP/2 一條 TCP 跑 N stream（解 application HOL）
  → 但 TCP 層還是 HOL
    ↓
HTTP/3 / QUIC over UDP（解 transport HOL）
  → 同時 0-RTT、connection migration 紅利

────（傳輸層做完）────（應用層的故事）────

Server 沒辦法主動推
  ↓
Polling 浪費（多半空回應）
  ↓
Long Polling 省空回應（hold connection）
  ↓
SSE 一條連線不關，server 持續寫（單向）
  ↓
WebSocket 升級協議，雙向（但要管 stateful）
  ↓
Socket.IO 兜底（先 long-poll 再升級）
```

兩條鏈交織起來才是完整圖。聊天室要雙向 → WebSocket。通知要 server 推 → SSE。挑哪個跑在哪個 HTTP 版本上 → 看連線佔用、看 proxy 友善度。
