---
title: "TCP 有問題，但沒有人修 TCP：QUIC 和 WebRTC 都選 UDP 的原因"
slug: why-udp
subtitle: "修 TCP 要等全世界換 kernel，發明新協議會被四十年的中間設備丟掉，所以 QUIC 和 WebRTC 都把自己的協議裝在 UDP 裡。"
chapter: "networking"
tags: [quic, http3, udp, tcp, webrtc, sctp, ossification]
date: 2026-07-20
related: [http-realtime-pushing, webrtc-nat-traversal]
---

# TCP 有問題，但沒有人修 TCP：QUIC 和 WebRTC 都選 UDP 的原因

前兩篇各自留了一個沒展開的細節：[即時推送那篇](article://http-realtime-pushing)講到 HTTP/3 換掉了 TCP，[WebRTC 那篇](article://webrtc-nat-traversal)的視訊流從第一天就走 UDP。兩個互不相干的技術，一個要解 head-of-line blocking，一個要解視訊延遲，最後都落在同一層：1980 年就定案的 UDP。

TCP 的問題人盡皆知，正常的直覺是修 TCP，或者發明一個更好的傳輸層。這兩條路都有人走過，但都沒能部署到整個網路上，所以 QUIC 選了 UDP。

## TCP 哪裡有問題

[HTTP/2](chunk://http2) 在一條 TCP 上跑幾十個 stream，但 [TCP](chunk://tcp) 不知道 stream 的存在，只認一條有序的 byte 流。任何一個 packet 丟了，後面全部的 byte 都要等重傳，等於一個 stream 出事、所有 stream 陪等。這是傳輸層的 head-of-line blocking，在應用層怎麼繞都繞不掉。

要根治，就需要一個「認得 stream」的傳輸層，丟包只影響出事的那條 stream。設計這種協議不難，SCTP（Stream Control Transmission Protocol）在 2000 年就設計出來了。難的是部署，要讓全世界的 OS 和網路設備都支援它。

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
on_timeout(seg):  send(seg); cwnd = 1 個 segment        # 沒 ACK → 重傳 + 從頭慢慢加速
on_recv(seg):     if 亂序: 先擺著等缺口補上; else 照順序交給 app   # 重組
# 再加握手、SACK、Nagle、流量控制… 全在這層（Linux 好幾萬行 C）
```

想改 TCP 任何一個行為，就是改 kernel。改完呢？等 Linux merge → 等發行版打包 → 等伺服器升級 kernel → 等 Windows、macOS、iOS、Android 各自跟進。一個改動要五年才會普及到整個網路。

QUIC 把重傳、congestion control、stream、TLS 全部搬進 user space library：Chrome 有 `quiche`、Cloudflare 有自己的 `quiche`、Microsoft 有 `msquic`、Meta 有 `mvfst`。每家獨立出新版本，Google 想試新的 congestion control，下次 Chrome 更新就生效，不用等任何一個 OS。

## 第二條路：發明新傳輸層。SCTP 試過了

SCTP 出身電信業，2000 年代設計來傳電話網路的 signaling，規格上就是「修好的 TCP」：內建 multi-stream、每條 stream 獨立重傳、沒有 head-of-line blocking。設計挑不出毛病。

結果它只在 datacenter 內部有人用，到了公開網路就用不了。網路上的封包不是只經過兩端，中間隔著 NAT、防火牆、ISP 的各種設備。這些設備四十年來看慣了 TCP（protocol number 6）和 UDP（17），看到 SCTP 的 132，判斷不了是什麼，最安全的處理就是丟掉。兩端都支援 SCTP 沒有用，中間任何一台設備把 SCTP 封包丟掉，連線就是建不起來。

這個現象有個名字：**protocol ossification**（協議僵化）。中間設備對「網路長什麼樣」的假設寫死在韌體裡，久了整個網路就只認得現存的協議。TCP 本身也受影響：TCP header 是明文，中間設備連 TCP option 都有假設，新增的 option 常常被拆掉。

## 剩下的路：借道 UDP

UDP 在 kernel 裡只加上 port 資訊就送出去，不留狀態。它不提供可靠傳輸，但 QUIC 本來就要自己做可靠傳輸，UDP 只要當一個「把封包交給網卡」的出口就好。

而且中間設備放行 UDP。DNS、VoIP、線上遊戲走了幾十年 UDP，全世界的 NAT 和防火牆都認得它，頂多做 port translation。QUIC 把自己的封包裝在 UDP 裡，這些設備就會放行。

學過 SCTP 的教訓，QUIC 還多做了一層防禦：從握手開始就用 TLS 1.3 加密。TCP 放在明文 header 裡的 ACK、視窗大小這些傳輸層資訊，QUIC 都放進加密的 payload，明文的只剩 connection ID 這類少數欄位，連 packet number 都另外加了一層 header protection。中間設備看不到內容，就沒辦法對內容做假設，未來也就不會出現「QUIC ossification」。

## WebRTC 更早就得出同一個結論

WebRTC 選 UDP 的第一理由跟 QUIC 不同。即時視訊寧可丟一幀畫面，也不能停下來等重傳，畫面等到了也過時了。TCP 的可靠傳輸在這個場景反而是缺點，所以媒體流走 UDP 上的 RTP（Real-time Transport Protocol），丟了就丟了。

WebRTC 能在公開網路上部署，也是靠 UDP。NAT hole punching（[STUN/TURN](chunk://stun-turn) 那套流程）在 UDP 上成功率高很多，RFC 5128 引用的測試裡，UDP 在八成以上的 NAT 上能成功，TCP 只有六成出頭。

WebRTC 的 DataChannel（傳資料用的通道，不是媒體流）傳的就是 SCTP，包在 DTLS（Datagram TLS）裡、跑在 UDP 上。SCTP 自己當傳輸層只在 datacenter 裡用得上，裝進 UDP 之後才能在公開網路上部署。

## 代價

- QUIC 在 user space 跑，CPU 比 kernel TCP 高：不能 zero-copy、syscall 多。近年補回不少：io_uring 讓 syscall 可以批次提交，sendmmsg 一次 syscall 送多個封包，GSO（Generic Segmentation Offload）把大封包交給網卡或 kernel 晚一點再切。
- 少數網路對 UDP 限流或直接封掉。瀏覽器遇到就自動 fallback 到 TCP 上的 HTTP/2，用戶不會察覺。
- Stateful 防火牆對 UDP 的連線狀態記得比較短，需要 keep-alive。

手機、家庭網路這種 last-mile 場景，丟包率高、換網路頻繁，QUIC 的 per-stream 重傳加上 connection migration（換網路不斷線）明顯比較好。datacenter 內部低丟包，QUIC 沒優勢，業界也沒急著把內部流量換掉。

## 服務要不要開 HTTP/3

情境：七成流量來自手機的電商，前面站 CDN，TTFB（Time To First Byte）的 p95 一直降不下來。

大部分服務其實不用自己改 server：站在 Cloudflare 或 CloudFront 後面的話，HTTP/3 是 CDN 設定裡的一個開關，開了之後用戶到 CDN 這段走 QUIC，CDN 回源繼續走原本的 HTTP/1.1 或 2，origin 一行不用改。回源那段在低丟包的骨幹網路上，本來就不是瓶頸。所以第一步就是把開關打開，看真實用戶監控（RUM）裡行動端的 TTFB 有沒有動。

全自架、沒有 CDN 的服務才需要動 server stack：Caddy 內建 HTTP/3，nginx 要新版本，或者前面加一層 Envoy。這一步成本高很多，值得做的前提是用戶真的直連自家機器、而且大量走行動網路。

有兩種情況會後悔。第一種是協議分佈：開了 H3 之後要看實際成功握手的比例。企業內網常封鎖 UDP，瀏覽器會默默 fallback，所以看起來大家都在跑 H3，實際上可能一半人還在 TCP 上。第二種是自架場景的 CPU，QUIC 的 user space 開銷會直接反映在機器成本。

---

SCTP 比 QUIC 早，設計也更乾淨，卻沒能在公開網路上部署。QUIC 從一開始就把「中間設備要放行」當成設計前提，所以部署成功了。
