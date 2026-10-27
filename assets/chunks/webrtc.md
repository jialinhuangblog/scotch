---
title: "WebRTC"
slug: webrtc
brief: "Server 只牽線，音訊視訊 browser 直連。低延遲的代價是要自己處理 signaling 和 NAT。"
date: 2026-07-12
updated: 2026-10-18
revisions: 2
article: webrtc-nat-traversal
---

# WebRTC

> WebSocket 的訊息都經過 server。視訊通話流量大又怕延遲，能不能讓兩個瀏覽器直接互傳？

## 拓撲不一樣

```
WebSocket：瀏覽器 A → server → 瀏覽器 B
WebRTC：  瀏覽器 A ─────────→ 瀏覽器 B
```

算一下差別。Google Meet 的網路規劃文件寫一路 720p 視訊最多 1.7Mbps。走 WebSocket，A 的影像先上傳到 server，server 再送給 B；B 的影像也一樣，先到 server 再送給 A。所以每一通話 server 要收兩路、送兩路，收 3.4Mbps、送 3.4Mbps，一萬通同時就是收 34Gbps、送 34Gbps。A 在台北、B 在台中、server 在東京的話，影像還要繞東京一圈。走 WebRTC，直連成功的通話，A 的封包直接送到 B，server 一個 bit 的影像都不經手，路徑也最短。直連失敗的改走 TURN 中繼，這些通話的影像照樣全程經過 TURN server，每一通花的頻寬跟上面算的差不多。

## Server 還是需要，但只負責牽線

連線前兩個瀏覽器互相不知道對方在哪。走一遍。A 按下通話，瀏覽器產生一份 SDP offer，裡面寫「我支援 VP8 跟 H.264，音訊用 Opus」，還有自己的候選地址。A 把這份 offer 透過 WebSocket 送給 server，server 轉給 B。B 收下，回一份 SDP answer，寫「那用 VP8 跟 Opus」，一樣經 server 轉回 A。這段叫 signaling。WebRTC 不規定 signaling 怎麼做，通常拿 WebSocket 實作，用 HTTP 輪詢也行。兩邊拿到對方的地址跟編碼，開始直接互送，server 就退出資料路徑。

NAT 後面的兩個瀏覽器怎麼真的連上，靠 STUN 問地址、TURN 保底中繼，細節在 [STUN / TURN](chunk://stun-turn)。

## 一對一之後的事

十個人開會，每人要跟另外九個人各建一條連線，自己的影像要上傳九份，九路 1.7Mbps 就是 15.3Mbps 上行，家用網路多半不夠。連線數是 N² 量級。實務上群組通話改用 SFU（Selective Forwarding Unit）：每人只上傳一份到 SFU，SFU 複製轉發給其他九人，但不解碼也不重新編碼，所以比 server 轉碼便宜得多。
