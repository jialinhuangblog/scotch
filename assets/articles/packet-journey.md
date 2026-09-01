---
title: "封包送出前，外面一層層的 OSI 封裝"
slug: packet-journey
subtitle: "MAC 會換，IP 不換。理解這件事，debug 的時候就知道看哪一層。"
chapter: "networking"
tags: [encapsulation, arp, tcp, dns]
date: 2026-04-07
related: [dns-journey, routing-journey, security-journey, four-interfaces-one-pod]
---

# 封包送出前，外面一層層的 OSI 封裝

終端打了 `curl api.example.com`。不到一秒，畫面上出現 JSON。

中間經過了什麼？

與其背「七層」，不如跟著資料走一趟：從這台筆電出發，跨過好幾台沒碰過的機器，到地球另一端的 server，再原路回來。

這趟旅程會經過這些 protocol：

| Protocol | 層級 | 做什麼 | 出場時機 |
|---|---|---|---|
| DHCP | L7 Application | 分配 IP、gateway、DNS server | 連上網路的第一步 |
| DNS | L7 Application | 域名翻成 IP | 送出封包之前 |
| TCP | L4 Transport | 可靠傳輸，port 對 port | 封裝階段 |
| ARP | L2 Data Link | IP 翻成 MAC | 每一跳送出 frame 之前 |
| NAT | L3 Network | private IP 換成 public IP | 封包離開家用路由器 |
| ICMP | L3 Network | ping、traceroute 的底層 | debug 排查 |

---

## 先搞清楚手上有什麼

筆電剛連上 Wi-Fi。什麼都不知道。沒有 IP，不知道 gateway 在哪，不知道 DNS server 是誰。

DHCP 解決這件事。筆電廣播一則訊息：「有人可以給我一個地址嗎？」路由器上的 DHCP server 回應：「IP 是 `192.168.1.42`，gateway 是 `192.168.1.1`，DNS server 是 `8.8.8.8`。」

現在手上有三樣東西：

| 東西 | 來自 | 作用 |
|---|---|---|
| IP 位址 `192.168.1.42` | DHCP | 網路上的門牌 |
| Gateway IP `192.168.1.1` | DHCP | 離開區域網路的出口 |
| DNS Server IP `8.8.8.8` | DHCP | 把域名翻成 IP 的翻譯機 |

還有一個出生就帶的：MAC 位址。48 bits，燒在網卡裡。格式 `00:AA:BB:CC:DD:EE`。前半段 `00:AA:BB` 是製造商代碼（OUI），由 IANA 分配。後半段 `CC:DD:EE` 是裝置編號，同一製造商內不重複。

---

## 名字變地址

`curl api.example.com` 裡的 `api.example.com` 是人類看的。機器要的是 IP。

筆電問 [DNS](chunk://dns) server：`api.example.com` 的 IP 是什麼？DNS 回答 `93.184.216.34`。這個查詢本身就是一趟封包旅行，用 UDP port 53。

目的地確定了。

---

## 打包

`curl` 要送一個 HTTP GET request。資料從上到下，一層一層被包起來。每一層加自己的 header，像套信封：

```
Application    HTTP GET /api/data              ← 信的內容
Transport      + TCP header (src:52341 dst:443) ← 小信封，寫了門牌號
Network        + IP header  (src:192.168.1.42 dst:93.184.216.34) ← 中信封，寫了城市地址
Data Link      + Ethernet header (src MAC:筆電 dst MAC:???) ← 大信封，寫了快遞站
```

最外層是 [Ethernet frame](chunk://encapsulation)。最裡面是 HTTP 資料。拆封反過來：對面 server 收到 frame，一層一層剝，最後拿到 HTTP request。

<iframe src="https://jialin00.com/packets/goes-and-comes?phase=encapsulation" width="100%" height="500" style="border:none;" loading="lazy"></iframe>

但有一個問題。IP header 裡填了目的地 `93.184.216.34`。Ethernet header 裡要填目的地 MAC。筆電不知道 `93.184.216.34` 的 MAC。

其實也不需要知道。

---

## 找到下一跳的 MAC

`93.184.216.34` 不在區域網路裡。筆電查路由表：「目的地不在 `192.168.1.0/24`，送去 gateway `192.168.1.1`。」

問題變成：`192.168.1.1` 的 MAC 是什麼？

[ARP](chunk://arp) 解決這件事。四步：

1. 筆電廣播：「誰的 IP 是 `192.168.1.1`？告訴我 MAC。」
2. Gateway 回應：「我是 `192.168.1.1`，MAC 是 `AA:BB:CC:DD:EE:FF`。」
3. 筆電把 IP → MAC 存進 ARP table。下次不用再問。
4. Ethernet header 的 destination MAC 填上 gateway 的 MAC。

注意：填的是 gateway 的 MAC，不是最終目的地 server 的 MAC。只需要知道「下一站」的地址。

<iframe src="https://jialin00.com/packets/goes-and-comes?phase=arp" width="100%" height="500" style="border:none;" loading="lazy"></iframe>

---

## 穿過第一台 Router

Frame 到了 gateway（家用路由器）。路由器做三件事：

1. **剝開 L2。** 丟掉 Ethernet header，讀出 IP packet。
2. **查路由表。** 目的地 `93.184.216.34` 要往哪走？下一跳是 ISP 路由器 `203.0.113.1`。
3. **貼新的 L2。** source MAC 改成自己，destination MAC 改成 ISP 路由器的 MAC。

NAT 也在這裡。private IP `192.168.1.42` 被換成 router 的 public IP。ISP 看到的 source IP 不是筆電，是路由器。

封包出了家門。

<iframe src="https://jialin00.com/packets/goes-and-comes?phase=router" width="100%" height="500" style="border:none;" loading="lazy"></iframe>

---

## 一跳一跳往前

ISP 路由器收到 frame。做一模一樣的事：剝 L2、讀 L3、查路由表、貼新 L2、送出。

每一台路由器都只做這件事。**IP header 不變，Ethernet header 每一跳都換。**

| | MAC | IP |
|---|---|---|
| 作用 | 找到下一站 | 找到最終目的地 |
| 變化 | 每一跳都換 | 全程不變 |
| 比喻 | 轉機的登機證 | 護照上的目的地 |
| 層級 | L2 Data Link | L3 Network |

不管轉幾次機，護照的目的地都不變，變的只是每段的登機證。

---

## 到達

經過若干跳，frame 到達目的地 server 所在的區域網路。最後一台路由器用 ARP 問到 server 的 MAC，把 frame 直接送過去。

Server 收到 frame，一層一層拆：

```
Ethernet header → 剝掉 → IP packet
IP header       → 剝掉 → TCP segment
TCP header      → 剝掉 → HTTP GET /api/data
```

Application 處理 request，生成 response。打包、送回。終端上出現 JSON。

整趟旅程，資料被包了又拆、拆了又包。每一台路由器只看兩層：L2 找下一跳，L3 決定往哪走。

<iframe src="https://jialin00.com/packets/goes-and-comes?phase=arrival" width="100%" height="500" style="border:none;" loading="lazy"></iframe>

---

## Debug 的時候，找哪一層壞了

連不上的時候，不要隨便 Google 錯誤訊息。從下到上排查：

| 指令 | 測的層 | 問的問題 |
|---|---|---|
| `arp -a` | L2 | 知道 gateway 的 MAC 嗎？ |
| `ping 93.184.216.34` | L3 | 封包能不能到對面？ |
| `traceroute 93.184.216.34` | L3 逐跳 | 封包在哪一跳斷了？ |
| `curl https://api.example.com` | L7 | HTTP 有沒有問題？ |
| `openssl s_client -connect ...` | TLS | 憑證有沒有問題？ |

`ping` 通但 `curl` 不通？問題在 L4 以上。`ping` 不通？L3 或以下。`arp -a` 裡沒有 gateway？L2 出了問題。

每個指令對應封包旅程的一個階段。知道旅程，就知道在哪裡斷。

### `arp -an` 輸出怎麼讀

L2 那一行值得多看一眼。`arp -an` 的輸出長這樣：

```text
? (192.168.0.1)   at fa:34:5a:6a:92:24  on en0 ifscope [ethernet]
? (192.168.0.96)  at b6:87:83:15:0a:1d  on en0 ifscope permanent [ethernet]
? (192.168.0.164) at f6:d9:fc:8a:68:d1  on en0 ifscope [ethernet]
? (224.0.0.251)   at 01:00:5e:00:00:fb  on en0 ifscope permanent [ethernet]
```

重點欄位：

- **`?`**：hostname 沒解析（`-n` 跳過反查）
- **`at MAC`**：學到的 MAC 位址
- **`on en0`**：從哪個介面學到的
- **`permanent`**：本機介面（自己的 IP）或 multicast group，永遠不過期
- 其他：動態學習的鄰居，會隨時間過期

看到某個 IP 標 `permanent` 就是你**自己的本機介面**，不是別人。

### 為什麼沒連過的鄰居也在 cache 裡

跑 `arp -an` 常常看到一堆你從來沒主動連過的 IP。來源：

1. **mDNS / Bonjour 廣播**：Apple 裝置、智慧家電定期 multicast 到 `224.0.0.251` 宣告自己的服務，你的機器被動收到，順便學到對方的 IP/MAC
2. **別人對你的 ARP 探測**：鄰居要找你的 MAC 時，你的回應也讓對方進入它們的 cache，通常同時你也記住對方
3. **網路上的 broadcast**：DHCP、NetBIOS、SSDP 這類廣播封包帶著 sender 資訊，kernel 順便學

所以 ARP cache **不是你主動建立的**，是平常那些廣播你問我答留下來的。

### 私密 MAC 的影響

現代裝置（尤其 Apple）會開啟 **MAC address randomization**：每個 WiFi network 用不同的隨機 MAC 替代硬體 MAC。這對 ARP 的直接影響：

- 同一台 iPhone 換 SSID（例如從 2.4G 切到 5G）可能換一個 MAC
- Router 的 ARP cache 和 DHCP client list 會出現「兩筆看起來不同但其實是同一台」的紀錄
- MAC 第二個 bit = 1 是 **locally administered**（隨機生成），= 0 是廠商硬體位址

看 MAC 第一個 byte 的第二位，可以分辨是硬體 MAC 還是隨機 MAC：

```text
fa:34:5a:...  →  fa = 1111 1010 → 第二位 = 1 → locally administered (隨機)
00:1b:63:...  →  00 = 0000 0000 → 第二位 = 0 → 硬體 MAC (Apple OUI)
```

現在家用網路看到的 MAC 幾乎都是 locally administered，硬體 MAC 已經少見。

---

## 回顧整趟路

```text
DHCP 拿地址
  → DNS 查 IP
    → 封裝（HTTP → TCP → IP → Ethernet）
      → ARP 問 gateway MAC
        → 送出 frame
          → Router：剝 L2 → 讀 L3 → 貼新 L2 → 送出
            → ... 重複 ...
              → 到達 → 拆封（Ethernet → IP → TCP → HTTP）
                → 回程原路走回
```

一個 `curl` 背後，跑了這整趟路。
