---
title: "TCP"
slug: tcp
brief: "可靠、有序、壅塞控制。"
article: packet-journey
date: 2026-03-09
updated: 2026-04-08
revisions: 1
---

# TCP

送出的每一個 byte 都可能丟失、重複、亂序到達。TCP 把這些混亂藏起來，讓上層以為網路是可靠的。

## 怎麼做到的

TCP 在每個 IP 封包上加 sequence number、ACK、checksum。發送端幫每個 byte 編號，接收端回報收到了什麼，沒收到的就重傳。

### 三次握手

連線建立要一個半 RTT：

```
Client → SYN        → Server
Client ← SYN-ACK    ← Server
Client → ACK + data → Server
```

Client 等一個 RTT 就能送資料，但資料抵達 server 時已經過了一個半 RTT。跨大西洋來回約 80ms 的鏈路，第一筆資料到 server 就要 120ms。

### 壅塞控制

TCP 一開始很慢。每個 RTT 把送出速率翻倍（slow start），直到偵測到丟包才降速。這樣單一連線不會塞滿整個網路，但新連線在前幾個 RTT 的送出速率都還很低。

## 代價

**可靠性換延遲。** 一個封包掉了，整條 stream 停住等重傳。這就是 head-of-line blocking。要是用 TCP 傳視訊，掉一個封包畫面就會 freeze，即使後面的 frame 早就到了。

**連線建立要時間。** 握手本身就有延遲，TLS 還要再加一輪。HTTP/3 換成 UDP（QUIC），一部分原因就是想省掉這些來回。

## 什麼時候用

正確性比速度重要的場景：HTTP API、資料庫連線、檔案傳輸。反過來，資料晚到就沒用的場景（直播、遊戲），或是一來一回就結束的小查詢（DNS），UDP 比較合適。

---

## References

- [Hibernia Express：紐約–倫敦海纜往返低於 58.95ms](https://www.submarinenetworks.com/en/systems/trans-atlantic/project-express/hibernia-express-connects-new-york-to-london-in-under-58-95ms)
