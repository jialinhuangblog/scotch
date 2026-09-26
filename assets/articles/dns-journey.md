---
title: "google.com 這 human readable 的域名，如何被轉成精確的數字 IP"
slug: dns-journey
subtitle: "一個域名從瀏覽器一路查到權威伺服器，中間問過哪幾台 server。"
chapter: "networking"
tags: [dns, tcp, encapsulation]
date: 2026-04-07
related: [packet-journey, routing-journey, security-journey]
---

# google.com 這 human readable 的域名，如何被轉成精確的數字 IP

[Packet Journey](article://packet-journey) 裡「DNS 回答 `93.184.216.34`」這一步只帶過一句，其實它本身就是另一趟完整的封包旅程。

這趟旅程會經過這些 protocol：

| Protocol | 層級 | 做什麼 | 出場時機 |
|---|---|---|---|
| DNS | L7 Application | 域名翻成 IP | 每一步 |
| UDP | L4 Transport | DNS 預設的傳輸方式 | 查詢和回應 |
| TCP | L4 Transport | 回應太大時的替代方案 | UDP 放不下的時候 |
| DHCP | L7 Application | 告訴主機 DNS server 在哪 | 最一開始 |
| DNSSEC | L7 Application | 簽章防止 DNS 偽造 | 安全驗證 |

---

## 從哪開始問

瀏覽器輸入 `google.com`，按下 Enter。瀏覽器需要 IP，但它不會直接問 DNS server，而是先查本機的 cache：

1. **瀏覽器 cache。** 剛查過的域名會暫存。Chrome 可以在 `chrome://net-internals/#dns` 看到。
2. **OS cache。** 瀏覽器沒有就問作業系統。macOS 的 `dscacheutil -cachedump` 或 Windows 的 `ipconfig /displaydns`。
3. **hosts 檔案。** `/etc/hosts`（或 `C:\Windows\System32\drivers\etc\hosts`）。手動寫死的對應，優先權比 DNS 高。

三層都沒有，才真的送出 DNS query。

---

## 問誰

連上網路的時候，DHCP 給了一個 DNS server IP，通常是家用路由器或 ISP 的 DNS server，有些網路會直接給 `8.8.8.8`。這台叫 **recursive resolver**。

「recursive」指的是它會跑完整條查詢鏈。主機只問它一次，它去問所有該問的 server，拿到答案再回傳。

主機跟 recursive resolver 之間用 UDP port 53。因為 DNS 查詢通常很小，一個 UDP datagram 就裝得下，也省掉 TCP 三次握手的延遲。

---

## 查詢鏈

Recursive resolver 自己也有 cache。如果沒命中，從最頂端開始往下問：

```
Recursive Resolver
  → Root Server（全球 13 組，回答「.com 去問誰」）
    → .com TLD Server（回答「google.com 去問誰」）
      → google.com 權威伺服器（回答「IP 是 142.250.80.46」）
```

每一層只知道「下一層去問誰」。Root 不知道 google.com 的 IP，但知道 .com 歸誰管。TLD 不知道 IP，但知道 google.com 的權威伺服器在哪。

### 階層結構

```
.                    ← Root Zone（IANA 管理）
├── .com             ← TLD（Top-Level Domain）
│   ├── google.com   ← Second-Level Domain
│   │   ├── www      ← Subdomain
│   │   ├── mail     ← Subdomain
│   │   └── api      ← Subdomain
│   └── example.com
├── .org
├── .edu
└── .tw
    └── .com.tw
        └── www.com.tw
```

`www.google.com` 的全名其實是 `www.google.com.`，最後那個點代表 root。平常省略不寫。

---

## TTL：cache 要存多久

權威伺服器回傳 IP 的時候，會附帶一個 TTL（Time To Live）。意思是「這個答案可以 cache 多久」。

| TTL | 優點 | 代價 |
|---|---|---|
| 短（30s） | 切換快，改 IP 後 30 秒生效 | 查詢量大，resolver 負擔重 |
| 長（3600s） | 省查詢，resolver 壓力小 | 改 IP 後最慘等一小時 |

「zero-downtime migration」的前提是 TTL 夠短。要是 TTL 是 3600 秒，切 IP 之後有些用戶會繼續連到舊 server，最久一個小時。

實務上平常 TTL 設長來節省查詢。遷移前先把 TTL 調短，讓 cache 早點過期，再切換 IP，等穩定之後才調回長 TTL。

---

## UDP 放不下的時候

DNS 回應超過 512 bytes（傳統限制），resolver 會收到一個截斷標記（TC flag）。這時候 resolver 用 [TCP](chunk://tcp) port 53 重新發送同一個查詢。

TCP 多了三次握手的延遲，但保證完整收到回應。

什麼情況下會超過 512 bytes？

- **DNSSEC。** 簽章資料很大。
- **多筆紀錄。** 一個域名對應大量 IP（CDN 場景）。
- **Zone transfer。** 主從 DNS server 之間同步整個 zone，一定走 TCP。

EDNS（Extension Mechanisms for DNS）讓 client 宣告自己收得下多大的 UDP 回應。2020 年的 DNS Flag Day 建議設成 1232 bytes，因為這個大小在幾乎所有網路上都不會被 IP 分片。所以大部分查詢不用改走 TCP，但 DNSSEC 這類大回應超過宣告的大小時，還是會 fallback 到 TCP。

---

## DNS 不只有 A record

DNS 回傳的不只是 IP。最常見的是 A record（域名翻成 IPv4），但紀錄類型其實有很多種，每一種回傳的內容不一樣：

| 紀錄類型 | 回傳什麼 | 用途 |
|---|---|---|
| A | IPv4 位址 | 最常見 |
| AAAA | IPv6 位址 | IPv6 環境 |
| CNAME | 另一個域名 | 別名，`www.example.com` → `example.com` |
| MX | 郵件伺服器 | `mail.google.com` 處理 `@gmail.com` 的信 |
| NS | 權威 DNS server | 告訴 resolver 去問誰 |
| TXT | 任意文字 | SPF、DKIM、domain 驗證 |

CNAME 會觸發額外查詢。查 `www.example.com` 得到 CNAME `example.com`，resolver 再查 `example.com` 的 A record 才拿到 IP，所以多了一次來回。

---

## DNS 的安全問題

DNS 查詢預設是明文，路上經過的每一台機器都讀得到「這台筆電正在查 google.com」。更嚴重的是 cache poisoning：攻擊者搶在權威伺服器之前回應假 IP，resolver 把假 IP 存進 cache，所有用這台 resolver 的人都被導到假網站。

| 威脅 | 防禦 | 層級 |
|---|---|---|
| Cache poisoning | DNSSEC（簽章驗證） | 保護回應真實性 |
| 竊聽查詢內容 | DoH（DNS over HTTPS）/ DoT（DNS over TLS） | 加密查詢本身 |
| 本地劫持 | 手動指定可信 resolver（`8.8.8.8`、`1.1.1.1`） | 繞過 ISP |

DNSSEC 驗證回應是不是真的，DoH / DoT 則讓查詢內容不被別人讀到。

---

## Debug DNS

| 指令 | 做什麼 |
|---|---|
| `nslookup google.com` | 最基本的 DNS 查詢 |
| `dig google.com` | 完整回應，包含 TTL、authority section |
| `dig +trace google.com` | 模擬整條查詢鏈，從 root 開始 |
| `dig google.com +short` | 只要 IP，不要其他 |
| `dig @8.8.8.8 google.com` | 指定用 Google DNS 查 |

`dig` 顯示原始的 DNS 回應，`nslookup` 則整理過，所以 debug 用 `dig`。

---

## 回到 Packet Journey

DNS 查詢本身就是一趟封包旅行。筆電把 DNS query 封裝成 UDP segment → IP packet → Ethernet frame，送到 recursive resolver。Resolver 可能再送出多趟查詢（root → TLD → 權威）。每一趟都走同樣的封裝、ARP、router 轉發流程。

Packet Journey 送到 web server，DNS 查詢送到 DNS server，不同的只有目的地。

要是每一層 cache 都沒命中，筆電到 resolver 要一趟，resolver 再問 root、TLD、權威伺服器各一趟。一個 `curl` 背後，前後要四趟封包旅行才取得一個 IP。
