---
title: "TLS"
slug: tls
brief: "TLS 1.3 一個 RTT 完成握手，用 CA 簽發的憑證證明 server 身份。代價是握手的 CPU 跟延遲。"
article: security-journey
date: 2026-03-09
updated: 2026-04-08
revisions: 1
---

# TLS

沒有 TLS 的話，client 跟 server 之間的每個封包，路上經過的每台機器都讀得到。密碼、token、API key 都是明文。TLS 把這條管道加密。

## 握手

TLS 1.3 的握手只要一個 RTT：

```
Client → ClientHello (支援的 cipher、key share) → Server
Client ← ServerHello (選定的 cipher、key share、憑證) ← Server
Client → Finished (已加密) → Server
```

雙方用 Diffie-Hellman 交換密鑰。共享密鑰從未在網路上傳過。Server 用 CA 簽發的憑證證明自己的身份。

TLS 1.2 要兩個 RTT。TLS 1.3 還支援 0-RTT resumption，重複連線時第一個封包就能帶資料。

## 憑證

憑證把域名綁到公鑰。信任鏈是 server 的憑證 → 中繼 CA 簽發 → 根 CA（瀏覽器預先信任）。

**Let's Encrypt** 讓簽發自動化。以前憑證要花錢，過期了還常常沒人注意，現在 auto-renewal 已經是預設做法。

**mTLS**（mutual TLS）反過來：server 也驗證 client 的憑證。常見於 service-to-service，雙方都需要身份證明。

## 成本

**CPU。** 握手用非對稱加密（RSA/ECDSA），per-connection 貴。但之後的對稱加密便宜。現代硬體有 AES-NI，跑幾 Gbps 不是問題。

**延遲。** 首次連線多一個 RTT（TLS 1.3）。長連線幾乎感覺不到，但大量短連線同時進來時，成本就很明顯。

## 什麼時候重要

公網上一定要用 TLS。內部網路裡，mTLS 是 zero-trust 的基礎，難處在憑證由誰簽發、誰負責輪替，service mesh 有一部分就是在處理這件事。
