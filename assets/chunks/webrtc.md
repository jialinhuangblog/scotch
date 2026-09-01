---
title: "WebRTC"
slug: webrtc
brief: "Server 只牽線，音訊視訊 browser 直連。低延遲的代價是要自己處理 signaling 和 NAT。"
date: 2026-07-12
article: webrtc-nat-traversal
---

# WebRTC

> WebSocket 的訊息都經過 server。視訊通話流量大又怕延遲，能不能讓兩個瀏覽器直接互傳？

## 拓撲不一樣

```
WebSocket：瀏覽器 A → server → 瀏覽器 B
WebRTC：  瀏覽器 A ─────────→ 瀏覽器 B
```

媒體流不經過 server：路徑最短、延遲最低，server 也不用付所有人的影像頻寬。

## Server 還是需要，但只負責牽線

連線前兩個瀏覽器互相不知道對方在哪。要先透過 server 交換「我在哪、支援什麼編碼」，這段叫 signaling。WebRTC 不規定 signaling 怎麼做，通常拿 WebSocket 實作。牽好線，server 就退出資料路徑。

NAT 後面的兩個瀏覽器怎麼真的連上，靠 STUN 問地址、TURN 保底中繼（另一片 chunk）。

## 一對一之後的事

多人全互連是 N² 條連線，十個人每人要上傳九路。實務上群組通話改用 SFU（Selective Forwarding Unit）：每人只上傳一份，server 轉發但不轉碼。
