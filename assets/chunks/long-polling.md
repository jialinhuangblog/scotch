---
title: "Long Polling"
slug: long-polling
brief: "Client 發一個 request，server hold 住到有資料才回。模擬 push 的最古老解，相容性最好。"
date: 2026-04-28
article: http-realtime-pushing
---

# Long Polling

> HTTP 是 request-response，server 沒辦法主動推。在 SSE 跟 WebSocket 出現之前，工程師怎麼做即時？

## Short Polling（baseline）

Client 用迴圈每隔幾秒發一次 request：

```ts
setInterval(() => fetch('/messages?since=100'), 5000);
```

Server 收到立刻回，沒新資料就回空 array。

```text
00:00 → GET /messages → 200 []
00:05 → GET /messages → 200 []
00:10 → GET /messages → 200 [{id: 101}]
```

**問題**：1000 個 user 每 5 秒問一次，server 每秒就要處理 200 個 request，而且大多是空回應。延遲也差，最壞要等整整一輪才看到新訊息。

## Long Polling

Client 同樣發一個 request，**server 故意不馬上回**：

```text
Client: GET /messages?since=100
Server: hold... hold... hold...
        （A 發訊息了）
Server: 200 [{id: 101}]
Client: GET /messages?since=101
Server: hold...
```

Server 端要自己做**等待機制**：

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

Server 要維護「正在等待的 requests」狀態，等內部事件觸發或 timeout 才回。

## 代價

| 維度 | 影響 |
|---|---|
| 連線常駐 | 10 萬 user 同時 hold = 10 萬條 TCP 在 server 開著 |
| 重連 overhead | 每收到回應都要重發新 request，HTTP/1.1 下又一次 header 傳輸 |
| Server 寫法 | 要 non-blocking I/O + pub/sub 才扛得住量 |
| 短暫空窗 | timeout / 重連那幾百毫秒收不到訊息 |

## 為什麼還有人用

[SSE](chunk://sse) 跟 [WebSocket](chunk://websocket) 都贏 long polling，但 long polling **就是 HTTP**：

- 任何 firewall / proxy / load balancer 都過得去
- 不需要 HTTP/1.1 的 chunked、不需要 Upgrade header
- HTTP/1.0 也跑得動（雖然每輪都重連 TCP）
- 後端任何 HTTP framework 都能寫，沒有 stream API 也行

**Socket.IO 的 fallback 就是 long polling**：先用 long polling 確保連得上，能升級才升級成 WebSocket。企業內網、嚴格 proxy 環境，long polling 是最後的退路。

---

Long polling 就是「我問你，你先別急著回」。做法最老，也最吃資源，但相容性最好，什麼環境都跑得動。
