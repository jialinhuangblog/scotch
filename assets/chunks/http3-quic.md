---
title: "HTTP/3 over QUIC"
slug: http3-quic
brief: "傳輸層也認識 stream，丟包只卡那一個 stream。蓋在 UDP 上避開 TCP 的 HOL blocking。"
date: 2026-04-28
updated: 2026-08-08
revisions: 4
article: why-udp
---

# HTTP/3 over QUIC

> HTTP/2 在應用層多工了，TCP 層還是保證整條連線照順序交付。一個 packet 丟了，所有 stream 一起卡住，怎麼從根本解決？

HTTP/3 丟包還是會重傳，但只有丟包的那條 stream 要等，其他 stream 照常交給應用。

## 動機

[HTTP/2 的 HOL blocking](chunk://http2)：50 個 stream 共用一條 TCP，stream 1 丟一個 packet，TCP 把後面的 packet 也留在 buffer 裡不交給應用，所以應用層看到的是 50 個 stream 全卡住。

問題出在 TCP。TCP 只認 byte 流，不知道有 stream 這件事，要根治就得換傳輸層。

## QUIC：UDP 上的傳輸層

```text
HTTP/3
  ↓
QUIC（傳輸層、stream 感知、加密內建）
  ↓
UDP（OS kernel 不插手的薄薄一層）
```

QUIC 自己重做了可靠傳輸、congestion control、ordering 這些 TCP 的功能，**但是以 stream 為單位**：

```text
stream 1 第 5 個 packet 丟掉
  ↓
QUIC：只有 stream 1 的後續資料等重傳，stream 2、3、4 繼續交給應用
  ↓
其他 49 個 stream 不受影響
```


## 為什麼建在 UDP 上

第一，TCP 的行為全在 OS kernel，想改要等每個 OS 都升級；QUIC 把重傳、congestion control、TLS 全搬進 user space library，瀏覽器自己更新就能改。第二，中間的 NAT 和防火牆只認識 TCP 跟 UDP，新的 protocol number 會被直接丟掉（SCTP，也就是 Stream Control Transmission Protocol，另一個傳輸層協議，就是因此在網際網路上無法普及），借 UDP 通過最保險。代價是 user space 的 CPU 較高；舊網路封 UDP 時，瀏覽器會自動 fallback 到 TCP H2。

## 0-RTT 連線

TCP + TLS 1.3 要兩次來回之後才能送出第一個 request。QUIC 蓋在 UDP 上，連線建立跟 TLS 握手是同一次來回。

```text
TCP + TLS 1.3（首次）
  → SYN
  ← SYN-ACK                        1 RTT：確認雙方通得了
  → ClientHello
  ← ServerHello + cert + Finished  2 RTT：金鑰換完
  → Finished + GET /
  ← response                       3 RTT：拿到資料

QUIC（首次）
  → Initial（含 ClientHello）
  ← ServerHello + Finished         1 RTT：連線跟金鑰一起好
  → GET /
  ← response                       2 RTT：拿到資料

QUIC（重連同一個 server）
  → Initial + GET /（用上次留下的金鑰先加密）
  ← response                       1 RTT：request 不用等握手，這就是 0-RTT
```

對行動網路 / 跨區 latency 高的場景，**0-RTT 省掉肉眼可見的延遲**。

## Connection Migration

TCP 連線綁定 (src_ip, src_port, dst_ip, dst_port)。手機從 Wi-Fi 切 4G，IP 變了，TCP 要重新連。

QUIC 用 connection ID 認連線，IP 換了照常用。所以看 YouTube 中途從 Wi-Fi 切到 4G，影片不會中斷。

## 普及狀況

- **Google、Cloudflare、Facebook 都跑 HTTP/3**，YouTube 大多數流量是 QUIC
- 瀏覽器全支援
- 公司內網 / data center 內 latency 低、丟包少，**HTTP/2 就夠**
- HTTP/3 的效益主要在丟包較多的 last-mile（手機、家庭網路）
