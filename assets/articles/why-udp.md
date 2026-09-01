---
title: "TCP 有問題，但沒有人修 TCP：QUIC 和 WebRTC 都選 UDP 的原因"
slug: why-udp
subtitle: "修 TCP 要等全世界換 kernel，發明新協定會被四十年的中間設備丟掉。兩條正路都不通，剩下的路是借道 UDP。"
chapter: "networking"
tags: [quic, http3, udp, tcp, webrtc, sctp, ossification]
date: 2026-07-20
related: [http-realtime-pushing, webrtc-nat-traversal]
---

# TCP 有問題，但沒有人修 TCP：QUIC 和 WebRTC 都選 UDP 的原因

前兩篇各自留了一個沒展開的細節：[即時推送那篇](article://http-realtime-pushing)講到 HTTP/3 換掉了 TCP，[WebRTC 那篇](article://webrtc-nat-traversal)的視訊流從第一天就走 UDP。兩個互不相干的技術，一個要解 head-of-line blocking，一個要解視訊延遲，最後站上同一層：1980 年就定案的 UDP。

這不是巧合。TCP 的問題人盡皆知，正常的直覺是修 TCP，或者發明一個更好的傳輸層。這兩條路都有人走過，也都走不通。QUIC 選 UDP 不是因為 UDP 好，是因為只剩這條路。

## 先回顧：TCP 到底哪裡有問題

[HTTP/2](chunk://http2) 在一條 TCP 上跑幾十個 stream，但 [TCP](chunk://tcp) 不知道 stream 的存在，只認一條有序的 byte 流。任何一個 packet 丟了，後面全部的 byte 都要等重傳，等於一個 stream 出事、所有 stream 陪等。這是傳輸層的 head-of-line blocking，在應用層怎麼繞都繞不掉。

要根治，就需要一個「認得 stream」的傳輸層，丟包只擋出事的那條 stream。問題從來不是怎麼設計它，SCTP（Stream Control Transmission Protocol）在 2000 年就設計出來了。問題是設計出來之後，要怎麼裝進全世界。

## 第一條路：修 TCP。修在誰身上？

TCP 不是一個 library，是 OS kernel 的一部分。跟 UDP 擺在一起看，差距很直觀：

```
# UDP 在 kernel：包個 header 送出去，就忘了
udp_send(data, dst):
    pkt = UDP_header(src_port, dst_port, len, checksum) + data
    交給 IP 層送出。完。               # 不留任何狀態（Linux 大概兩百行）

# TCP 在 kernel：每條連線維護一坨狀態，背後一直在跑
tcp_send(data):
    for seg in split(data, MSS):       # 1. 切段
        seg.seq = next_seq             # 2. 編號
        unacked.add(seg)               # 3. 沒被 ACK 不能丟
        if cwnd 允許: send(seg)        # 4. 壅塞控制決定一次送多少
on_ack(ack):      unacked.remove(<=ack); cwnd 放大      # 收到 ACK → 清掉 + 加速
on_timeout(seg):  send(seg); cwnd 砍半                  # 沒 ACK → 重傳 + 退讓
on_recv(seg):     if 亂序: 先擺著等缺口補上; else 照順序交給 app   # 重組
# 再加握手、SACK、Nagle、流量控制… 全在這層（Linux 好幾萬行 C）
```

想改 TCP 任何一個行為，就是改 kernel。改完呢？等 Linux merge → 等發行版打包 → 等伺服器升級 kernel → 等 Windows、macOS、iOS、Android 各自跟進。一個改動要五年才走得到全網。TCP 像大樓牆裡的共用水管，你家水壓有問題，要等整棟都更才能換管線，而這棟大樓是整個地球。

QUIC 的做法是把水管搬出牆壁。重傳、congestion control、stream、TLS，全部搬進 user space library：Chrome 有 `quiche`、Cloudflare 有自己的 `quiche`、Microsoft 有 `msquic`、Meta 有 `mvfst`。每家獨立出新版本，Google 想試新的 congestion control，下次 Chrome 更新就生效，不用等任何一個 OS。

## 第二條路：發明新傳輸層。SCTP 試過了

SCTP 出身電信業，2000 年代設計來傳電話網路的 signaling，規格上就是「修好的 TCP」：內建 multi-stream、每條 stream 獨立重傳、沒有 head-of-line blocking。設計挑不出毛病。

結果它跑不出 datacenter。網路上的封包不是只經過兩端，中間隔著 NAT、防火牆、ISP 的各種設備。這些設備四十年來看慣了 TCP（protocol number 6）和 UDP（17），看到 SCTP 的 132，判斷不了是什麼，最安全的處理就是丟掉。兩端都支援 SCTP 沒有用，中間任何一台設備丟包，連線就是建不起來。SCTP 部署失敗，不是輸在設計，是輸在通不過中間設備。

這個現象有個名字：**protocol ossification**（協定僵化）。中間設備對「網路長什麼樣」的假設寫死在韌體裡，久了整個網路就只認識現存的協定形狀。TCP 自己也是受害者，TCP header 明文暴露，中間設備連 TCP option 都有假設，新增的 option 常常被拆掉。網路表面上是分層的，實際上每一層都被中間設備盯著。

## 剩下的路：借道 UDP

UDP 在 kernel 裡薄到只做一件事：加上 port 資訊送出去，不留狀態。它給不了可靠傳輸，但 QUIC 本來就要自己做可靠傳輸，UDP 只要當一個「把封包交給網卡」的出口就好。

而 UDP 拿得到通行證。DNS、VoIP、線上遊戲走了幾十年 UDP，全世界的 NAT 和防火牆都認得它，頂多做 port translation，不會多問。QUIC 借 UDP 過關，等於拿著中間設備都認得的證件，裡面裝自己的東西。

學過 SCTP 的教訓，QUIC 還多做了一層防禦：從第一個 byte 就用 TLS 1.3 加密，連 transport header 都包起來。中間設備看不到內容，就沒辦法對內容養成假設，未來也就不會出現「QUIC ossification」。加密在這裡不只是安全功能，是防僵化的設計。

## WebRTC 早八年就得出同一個結論

WebRTC 選 UDP 的第一理由跟 QUIC 不同。即時視訊寧可丟一格畫面，也不能停下來等重傳，畫面等到了也過時了。TCP 的可靠傳輸在這個場景是負資產，所以媒體流走 UDP 上的 RTP（Real-time Transport Protocol），丟了就丟了。

但它能落地，用的還是同一張通行證：NAT hole punching 只在 UDP 上做得起來（[STUN/TURN](chunk://stun-turn) 那套流程），而中間設備放行 UDP。理由不同，結論相同：要在真實網路上部署新東西，UDP 是唯一還開著的門。

SCTP 的故事在這裡有個結尾。WebRTC 的 DataChannel（傳資料用的通道，不是媒體流）傳的就是 SCTP，包在 DTLS（Datagram TLS）裡、跑在 UDP 上。SCTP 自己當傳輸層走不出 datacenter，換成躲進 UDP 裡，活得好好的。協定沒問題，載體才是問題。

## 代價

- QUIC 在 user space 跑，CPU 比 kernel TCP 高：不能 zero-copy、syscall 多。近年 io_uring、sendmmsg、GSO 補回不少。
- 少數網路對 UDP 限流或直接封掉。瀏覽器遇到就自動 fallback 到 TCP 上的 HTTP/2，用戶無感。
- Stateful 防火牆對 UDP 的連線狀態記得比較短，需要 keep-alive。

值不值？看用戶在哪。手機、家庭網路這種 last-mile 場景，丟包率高、換網路頻繁，QUIC 的 per-stream 重傳加 connection migration 明顯贏。datacenter 內部低丟包，QUIC 沒優勢，業界也沒急著把內部流量換掉。

## 決策視角：你的服務要不要開 HTTP/3

情境：七成流量來自手機的電商，前面站 CDN，TTFB（Time To First Byte）的 p95 一直壓不下來。

決策路徑通常長這樣。先發現大部分服務根本不用自己動手：站在 Cloudflare 或 CloudFront 後面的話，HTTP/3 是 CDN 設定裡的一個開關，開了之後用戶到 CDN 這段走 QUIC，CDN 回源繼續走原本的 HTTP/1.1 或 2，origin 一行不用改。回源那段在低丟包的骨幹網路上，本來就不是瓶頸。所以第一步就是把開關打開，看真實用戶監控（RUM）裡行動端的 TTFB 有沒有動。

全自架、沒有 CDN 的服務才需要動 server stack：Caddy 內建 HTTP/3，nginx 要新版本，或者前面加一層 Envoy。這一步成本高很多，值得做的前提是用戶真的直連你的機器、而且大量走行動網路。

Regret signal 有兩個。一是協定分佈：開了 H3 之後要看實際成功握手的比例，企業內網常擋 UDP，瀏覽器默默 fallback，你以為大家在跑 H3，實際一半人還在 TCP 上。二是自架場景的 CPU：QUIC 的 user space 開銷直接反映在機器帳單，流量大了要重新算這筆帳。

---

三篇連起來是同一課。SCTP 設計得比 QUIC 早、也乾淨，卻沒能部署起來；QUIC 把部署當成第一約束來設計，反而活了下來。評估一個新協定，與其看 spec 設計得漂不漂亮，不如看它打算怎麼通過中間設備。
