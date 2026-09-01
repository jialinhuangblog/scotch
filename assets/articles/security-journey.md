---
title: "封包跑在公開網路上，怎麼確保不被偷看或竄改"
slug: security-journey
subtitle: "加密不等於安全。TLS 保護內容，IPsec 保護封包，但都擋不住你自己把門打開。"
chapter: "networking"
tags: [tls, tcp, encapsulation]
date: 2026-04-07
related: [packet-journey, dns-journey, routing-journey]
---

# 封包跑在公開網路上，怎麼確保不被偷看或竄改

[Packet Journey](article://packet-journey) 裡封包穿過好幾台 router。每一台都能看到 IP header。如果沒有加密，每一台都能看到裡面的資料。密碼、token、信用卡號。全部明文。

這篇講的是：怎麼讓中間的人看不到、改不了。

這趟旅程會經過這些 protocol：

| Protocol | 層級 | 做什麼 | 出場時機 |
|---|---|---|---|
| TLS | L5-6 Session/Presentation | 加密 application 資料 | HTTPS、API 呼叫 |
| IPsec | L3 Network | 加密整個 IP packet | VPN、site-to-site |
| SSH | L7 Application | 加密遠端連線 | 取代 Telnet |
| Telnet | L7 Application | 明文遠端連線 | 歷史對照 |
| DNSSEC | L7 Application | DNS 回應簽章 | DNS 防偽造 |

---

## 保護什麼，在哪一層

不同的安全 protocol 保護不同的東西，在不同的層級：

| | TLS | IPsec | SSH |
|---|---|---|---|
| 保護什麼 | Application 資料 | 整個 IP packet | 遠端 shell session |
| 在哪一層 | L5-6（TCP 之上） | L3（IP 層） | L7（Application） |
| 誰用 | 瀏覽器、API、資料庫連線 | VPN、企業跨站 | 工程師連 server |
| 中間 router 看到什麼 | IP header + TCP header（明文），payload 加密 | 視模式而定（見下方） | IP header + TCP header（明文），payload 加密 |

TLS 和 SSH 都跑在 TCP 之上。Router 還是看得到 IP 和 TCP header（知道封包要去哪、走哪個 port），但看不到內容。

IPsec 在 IP 層。可以連 header 都加密（tunnel mode）。

---

## TLS：加密管道

[TLS](chunk://tls) 是最常碰到的。HTTPS 就是 HTTP + TLS。

### 握手

TLS 1.3 一個 RTT 完成：

```
Client → ClientHello（支援的加密演算法、key share）
Client ← ServerHello（選定的演算法、key share、憑證）
Client → Finished（加密開始）
```

這一步靠 Diffie-Hellman key exchange。雙方各自生成一半密鑰，交換公開部分，各自算出相同的共享密鑰。共享密鑰從未在網路上傳過。

中間人就算攔截了 ClientHello 和 ServerHello，也算不出共享密鑰。

### 憑證

握手裡 server 送了一張憑證。憑證把域名綁到公鑰。信任鏈：

```
Root CA（瀏覽器預先信任）
  → 中繼 CA 簽發
    → server 的憑證
```

Client 驗證：這張憑證是不是被信任的 CA 簽的、域名對不對、有沒有過期。任一項不對，連線中斷。

**Let's Encrypt** 讓憑證簽發自動化。以前要花錢買，現在免費、auto-renewal 是標配。

### mTLS

一般 TLS 只有 client 驗 server。mTLS（mutual TLS）反過來：server 也驗 client 的憑證。

常見於 service-to-service。微服務之間不是用帳密，是用憑證互相認。Service mesh 存在的部分原因就是自動化管理這些憑證。

### TLS 的代價

| 項目 | 成本 |
|---|---|
| 握手延遲 | TLS 1.3 一個 RTT。TLS 1.2 兩個 RTT |
| CPU | 握手用非對稱加密（貴），之後用對稱加密（便宜，有 AES-NI 硬體加速） |
| 0-RTT resumption | 重複連線可以省掉握手，但有 replay attack 風險 |

長連線幾乎無感。大量短連線一起來，每次握手的延遲累積起來會很有感。HTTP/3（QUIC）把 TLS 握手和傳輸層握手合併，省到 0-RTT。

---

## IPsec：在 IP 層加密

TLS 保護的是 application 資料。IPsec 保護的是 IP packet 本身。

兩個子協定：

| | AH（Authentication Header） | ESP（Encapsulating Security Payload） |
|---|---|---|
| 做什麼 | 驗證完整性（沒被改過） | 加密 + 驗證完整性 |
| 加密？ | 不加密 | 加密 |
| 實務 | 幾乎沒人單獨用 | 主流 |

### 兩種模式

**Transport Mode：** 只加密 payload（TCP/UDP 以上）。IP header 維持明文。用在 host-to-host。

```
[IP Header 明文] [ESP Header] [TCP+Data 加密] [ESP Trailer]
```

**Tunnel Mode：** 整個原始 IP packet 加密，外面再包一層新的 IP header。用在 site-to-site VPN。

```
[新 IP Header] [ESP Header] [原始 IP Header + TCP + Data 全部加密] [ESP Trailer]
```

Tunnel mode 裡，中間的 router 只看到新的 IP header。原始的 source IP、destination IP 都藏在加密裡。

### VPN 就是 IPsec tunnel

企業兩個辦公室之間的 VPN，通常是 IPsec tunnel mode。兩端的 VPN gateway 負責加解密。中間的封包穿過公網，但沒人知道裡面是什麼。

---

## 從 Telnet 到 SSH

1990 年代，連遠端 server 用 Telnet。帳號密碼明文傳。

```
Telnet:  帳號 admin → 明文 → 任何人攔截都看得到
SSH:     帳號 admin → 加密 → 中間人只看到亂碼
```

SSH（Secure Shell）把整個 session 加密。取代 Telnet，沒有中間地帶。

SSH 兩種認證方式：
1. **密碼認證。** 密碼透過加密通道傳。安全，但密碼本身可以被猜。
2. **金鑰認證。** Client 持有 private key，server 持有 public key。不傳密碼，不怕被猜。

生產環境一律用金鑰認證，禁用密碼登入。

---

## 加密了，然後安全了嗎

加密解決的是「傳輸過程被偷看或竄改」。但安全問題不只這一種：

| 威脅 | 加密能防嗎 | 該怎麼防 |
|---|---|---|
| 中間人竊聽 | TLS、IPsec 都能防 | 已解決 |
| 中間人竄改 | TLS、IPsec 有完整性驗證 | 已解決 |
| DNS 被竄改（連到假 server） | TLS 憑證驗證能擋 | DNSSEC + TLS |
| Server 被入侵 | 加密保護傳輸，不保護 server | WAF、patch、權限控制 |
| 用戶自己輸入密碼到釣魚網站 | 加密完美運作中 | 沒有技術解，只有教育 |

加密保護管道，不保護管道兩端。HTTPS 的鎖頭只代表「傳輸過程安全」，不代表「對面是好人」。

---

## BGP Hijack：路被改了，加密也沒用

還有一類威脅不在上表：封包根本沒走到該去的地方。網際網路的路由靠 BGP（Border Gateway Protocol）在 AS（Autonomous System，自治系統）之間互相通告「我能到這些網段」。BGP 建立在信任之上，任何 AS 都能宣告任何網段，沒有內建驗證。

2008 年那次經典事故，時間線：

1. **平常**：YouTube（AS36561）一直在廣播自己的 `208.65.152.0/22`。
2. **18:47 UTC**：巴基斯坦政府要封 YouTube，巴基斯坦電信（AS17557）在自己的 BGP 宣告一條更精確的 `208.65.153.0/24`（夾在 YouTube 那塊 `/22` 裡面），想把國內流量導去自己的 router 丟掉。
3. **不小心外洩**：這條 `/24` 透過 eBGP 傳給了上游 transit 商 PCCW（AS3491），PCCW 沒驗證就轉給全世界。
4. **其他 AS 被感染**：全世界的 router 把這筆 `/24` 收進路由表。之後轉發時走 longest prefix match，`/24`（256 個 IP）的遮罩比 `/22`（1024 個 IP）長，打 YouTube 的封包一律轉去巴基斯坦。流量湧進巴基斯坦、被丟掉，YouTube 全球連不上。
5. **20:18 UTC**：YouTube 反制，丟出比 hijack 更細的兩條 `/25`（`208.65.153.0/25`、`208.65.153.128/25`），在願意收 /25 的網路上把流量搶回來。比 `/24` 更精確的網段大多會被 ISP 過濾掉（不然全球路由表會被一堆小網段撐爆），所以 `/25` 差不多就是還推得動的極限。
6. **21:01 UTC 收場**：PCCW 撤掉巴基斯坦電信所有路由，hijack 結束。從第一條假宣告算起，全球斷線約 2 小時 14 分。

### 為什麼巴基斯坦自己的宣告會跑到全世界

BGP 裡沒有國家這種概念，也沒有哪個 AS 因為規模大、是國家級電信，講話就比較有份量。一條宣告能傳多遠，只看沿途有沒有人設 filter 把它丟掉。這次沿途都沒設。

第一關在巴基斯坦電信自己身上。他們只想把國內打 YouTube 的流量導去自家 router 丟掉，那條 `/24` 應該留在 iBGP 裡，或掛上 `NO_EXPORT` community，讓它出不了自家 AS。兩件都沒做，這條路由就跟著平常那些對外宣告，一起送進了給 PCCW 的 eBGP session。

第二關在 PCCW。transit 商對客戶的 session 通常會設 prefix filter：這個客戶只准宣告他在 IRR（Internet Routing Registry）登記過的那幾塊網段，其他一律丟掉。那條 session 上沒有這道 filter，PCCW 就收下來，再轉給自己所有的 peer。

轉出去之後，其他人看到的是一條長得很正常的路由：`208.65.153.0/24`，AS path `… 3491 17557`。沒有 router 會去查 AS17557 到底有沒有資格宣告這塊網段，BGP 不驗證 origin。所以「其他 AS 無條件相信」這個講法沒錯，只是相信的對象是隔壁鄰居，不是哪個國家。每個 AS 預設收下鄰居送來的任何宣告，除非自己在那條 session 上配了 filter。

而 filter 設不設得起來是不對稱的。對客戶好設：客戶就那幾塊網段，登記在 IRR 裡，一年改不了幾次。對上游難設：上游一次送你幾十萬條路由，沒辦法逐條去驗誰有資格宣告什麼。

### 為什麼全世界的 router 都改走那條

先講一件反直覺的：這兩條路由從頭到尾沒有比過。BGP 的選路演算法（local preference、AS path 長度、MED 那一串）只在同一個 prefix 收到多條路徑時才跑。`208.65.152.0/22` 跟 `208.65.153.0/24` 是不同的 prefix，router 兩筆都留在表裡，誰也沒淘汰誰。

事情發生在轉發的那一刻。一個目的地 `208.65.153.10` 的封包進來，router 查表，兩筆都符合：

```
208.65.152.0/22  涵蓋 .152.0 ~ .155.255   ← 符合
208.65.153.0/24  涵蓋 .153.0 ~ .153.255   ← 也符合，而且遮罩更長
```

查表規則是 longest prefix match：遮罩最長的那筆勝出。這是 IP 轉發從一開始就有的規則，跟 BGP 的政策無關，也沒有哪個屬性可以覆蓋它。

所以沒有任何一台 router「決定」要相信巴基斯坦。它們收到一筆新的、更細的表項，照常放進表裡，之後每次查表就自然選到它。YouTube 那筆 `/22` 一直都在，也沒被覆蓋，只是目的地落在 `.153.x` 的封包再也輪不到它；落在 `.152.x`、`.154.x`、`.155.x` 的封包照樣走 YouTube。

YouTube 只能丟 `/25` 反制，原因也在這裡：要拿回 `.153.x` 的流量，唯一的辦法是再細一級。攻擊面也一樣，不用攻破任何東西，放一條前綴更細的假路由就夠。

防禦：RPKI（Resource Public Key Infrastructure）用數位簽章驗證「這個 AS 有沒有權利宣告這個網段」。但採用率還在爬升中，不是所有 AS 都檢查。TLS 保得住內容（流量被劫走，中間人還是讀不到），保不住封包會不會到。2008 那兩個小時，全世界的瀏覽器看到的不是憑證警告，是連線逾時。封包進了巴基斯坦就被丟掉，TLS 連握手的機會都沒有。

---

## 各層的安全覆蓋

把 Packet Journey 的每一層攤開，看各層有什麼保護：

| 層 | 保護手段 | 防的是什麼 |
|---|---|---|
| L7 Application | SSH、HTTPS（TLS）、SFTP | 假請求、弱密碼、應用層的邏輯漏洞 |
| L5-6 | TLS 握手、憑證驗證 | 對面不是本人（中間人） |
| L4 Transport | TCP port 過濾（防火牆） | 不該對外開的服務被連上 |
| L3 Network | IPsec、防火牆 IP 規則、RPKI | 來源 IP 偽造、路由被改道 |
| L2 Data Link | 802.1X（port 認證）、MAC 過濾 | 有人把自己的筆電插進會議室的網路孔 |
| L1 Physical | 物理隔離、門禁 | 有人走進機房把線拔掉、接一台自己的機器 |

BGP hijack 屬於 L3。AS 交換的是「哪個網段往哪走」，改的是每台 router 的 L3 轉發表，所以 RPKI 放在 L3 這排（BGP session 自己跑在 TCP 179 上，那是傳輸手段，不是它管的層）。

每一層都有各自的保護手段。沒有單一 protocol 能保護所有層。深度防禦（defense in depth）的意思就是：每一層都設防，不指望任何一層擋住所有攻擊。

---

## 回到 Packet Journey

封包穿過 router 的時候，router 看得到 IP header。用了 TLS，router 看不到 HTTP 內容。用了 IPsec tunnel mode，router 連原始 IP 都看不到。

但不管怎麼加密，封包還是得走完 Packet Journey 的每一步：封裝、ARP、router 轉發。加密改變的不是旅程本身，是旅程中誰能看到什麼。

---

## References

- [YouTube Hijacking: A RIPE NCC RIS case study](https://www.ripe.net/about-us/news/youtube-hijacking-a-ripe-ncc-ris-case-study/) — 2008 巴基斯坦電信 YouTube BGP hijack 始末
