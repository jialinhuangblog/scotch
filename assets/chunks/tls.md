---
title: "TLS"
slug: tls
brief: "TLS 1.3 一個 RTT 完成握手，用 CA 簽發的憑證證明 server 身份。代價是握手的 CPU 跟延遲。"
article: security-journey
date: 2026-03-09
updated: 2026-10-18
revisions: 3
---

# TLS

沒有 TLS 的話，client 跟 server 之間的每個封包，路上經過的每台機器都讀得到。密碼、token、API key 都是明文。TLS 把這條管道加密。

## 握手

瀏覽器第一次連 shop.example，TLS 1.3 的握手只要一個 RTT：

```
Client → ClientHello (支援的 cipher、key share) → Server
Client ← ServerHello (選定的 cipher、key share) ← Server
Client ← EncryptedExtensions、Certificate、CertificateVerify、Finished (已加密) ← Server
Client → Finished (已加密) → Server
```

key share 是 Diffie-Hellman 的材料。雙方各自隨機選一個私密數字，只把算出來的公開值送給對方，拿到對方的公開值之後，各自在本機算出同一把共享密鑰。路上的人看到的是兩個公開值，少了任何一方的私密數字就算不出密鑰，所以密鑰本身從未在網路上傳過。之後兩邊都用這把密鑰做對稱加密。

ServerHello 一送出，雙方手上都有了對方的 key share，算得出握手用的密鑰，所以 server 緊接著送的那幾則都已經加密。憑證在其中的 Certificate 裡，路上的人看不到；CertificateVerify 是 server 用憑證對應的私鑰簽的一段簽名，證明這張憑證真的是它的。憑證怎麼證明對面是 shop.example，下一節講。TLS 1.2 要兩個 RTT，而且憑證是明文送的。TLS 1.3 還支援 0-RTT resumption，重複連線時第一個封包就能帶資料。

## 憑證

密鑰有了，但怎麼知道對面是 shop.example 本人，不是路上某台機器冒充的？憑證把域名綁到公鑰。瀏覽器收到的憑證上寫著 shop.example 跟它的公鑰，由一個中繼 CA 簽名；中繼 CA 自己的憑證又由根 CA 簽名；根 CA 的憑證早就裝在瀏覽器裡。瀏覽器沿著這條鏈驗簽，三段都對、域名也對，才往下走。冒充的人可以自己做一張寫著 shop.example 的憑證，但拿不到任何瀏覽器信任的 CA 簽名，瀏覽器會直接拒絕。

**Let's Encrypt** 讓簽發自動化。以前憑證要花錢，過期了還常常沒人注意，現在 auto-renewal 已經是預設做法。

**mTLS**（mutual TLS）反過來：server 也驗證 client 的憑證。常見於 service-to-service，雙方都需要身份證明。

## 成本

**CPU。** 握手用非對稱加密（RSA/ECDSA），per-connection 貴。但之後的對稱加密便宜。現代硬體有 AES-NI，跑幾 Gbps 不是問題。

**延遲。** 首次連線多一個 RTT（TLS 1.3）。長連線幾乎感覺不到，但大量短連線同時進來時，成本就很明顯。

## 什麼時候重要

公網上一定要用 TLS。內部網路裡，mTLS 是 zero-trust 的基礎，難處在憑證由誰簽發、誰負責輪替，service mesh 有一部分就是在處理這件事。
