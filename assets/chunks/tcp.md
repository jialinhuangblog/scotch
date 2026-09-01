---
title: "TCP"
slug: tcp
brief: "可靠、有序、壅塞控制。網路的主力。"
article: packet-journey
date: 2026-03-09
updated: 2026-04-08
revisions: 1
---

# TCP

你送出的每一個 byte 都可能丟失、重複、亂序到達。TCP 把這些混亂藏起來，讓上層以為網路是可靠的。

## 怎麼做到的

TCP 在每個 IP 封包上加 sequence number、ACK、checksum。發送端幫每個 byte 編號，接收端回報收到了什麼，沒收到的就重傳。

### 三次握手

連線建立要一個半 RTT：

```
Client → SYN        → Server
Client ← SYN-ACK    ← Server
Client → ACK + data → Server
```

跨大西洋來回約 80ms 的鏈路，光握手（一個半 RTT）就要 120ms。

### 壅塞控制

TCP 一開始很慢。每個 RTT 把送出速率翻倍（slow start），直到偵測到丟包才降速。這防止單一連線灌爆整個網路，但也意味著新連線一開始都還在暖機。

## 代價

**可靠性換延遲。** 一個封包掉了，整條 stream 停住等重傳。這就是 head-of-line blocking。視訊通話中掉一個封包，整個畫面凍結，即使後面的 frame 早就到了。

**連線建立要時間。** 握手本身加延遲，TLS 再疊一層。HTTP/3 換成 UDP（QUIC），一部分原因就是想省掉這些來回。

## 什麼時候用

正確性比速度重要的場景：HTTP API、資料庫連線、檔案傳輸。反過來，過期資料比遲到資料好的場景（直播、遊戲、DNS 查詢），UDP 比較合適。

---

## References

- [Hibernia Express：紐約–倫敦海纜往返低於 58.95ms](https://www.submarinenetworks.com/en/systems/trans-atlantic/project-express/hibernia-express-connects-new-york-to-london-in-under-58-95ms)
