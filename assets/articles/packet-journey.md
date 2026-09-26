---
title: "封包送出前，外面一層層的 OSI 封裝"
slug: packet-journey
subtitle: "MAC 每一跳都換，IP 位址只有 NAT 會換。"
chapter: "networking"
tags: [encapsulation, arp, tcp, dns]
date: 2026-04-07
related: [dns-journey, routing-journey, security-journey, four-interfaces-one-pod]
---

# 封包送出前，外面一層層的 OSI 封裝

終端打了 `curl api.example.com`。不到一秒，畫面上出現 JSON。

中間經過了什麼？

資料從這台筆電出發，經過好幾台沒碰過的機器，到地球另一端的 server。回應再傳回來，回程不一定走同一條路。

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

## DHCP：拿到 IP、gateway、DNS

筆電剛連上 Wi-Fi 的時候還沒有 IP，也不知道 gateway 在哪、DNS server 是誰。

這些設定由 DHCP 提供。筆電廣播一則訊息：「有人可以給我一個地址嗎？」路由器上的 DHCP server 回應：「IP 是 `192.168.1.42`，gateway 是 `192.168.1.1`，DNS server 是 `8.8.8.8`。」

筆電現在有這三個設定：

| 設定 | 來自 | 作用 |
|---|---|---|
| IP 位址 `192.168.1.42` | DHCP | 網路上的門牌 |
| Gateway IP `192.168.1.1` | DHCP | 離開區域網路的出口 |
| DNS Server IP `8.8.8.8` | DHCP | 把域名翻成 IP 的翻譯機 |

另外還有一個網卡出廠就有的 MAC 位址。48 bits，燒在網卡裡。格式 `00:AA:BB:CC:DD:EE`。前半段 `00:AA:BB` 是製造商代碼（OUI），由 IEEE 分配。後半段 `CC:DD:EE` 是裝置編號，同一製造商內不重複。

---

## 名字變地址

`curl api.example.com` 裡的 `api.example.com` 是給人看的，機器要的是 IP。

筆電問 [DNS](chunk://dns) server：`api.example.com` 的 IP 是什麼？DNS 回答 `93.184.216.34`。這個查詢本身就是一趟封包旅行，用 UDP port 53。

目的地確定了。

---

## 打包

`curl` 要送一個 HTTP GET request。資料從上到下一層一層包起來，每一層加上自己的 header，像套信封：

```
Application    HTTP GET /api/data              ← 信的內容
Transport      + TCP header (src:52341 dst:443) ← 小信封，寫了門牌號
Network        + IP header  (src:192.168.1.42 dst:93.184.216.34) ← 中信封，寫了城市地址
Data Link      + Ethernet header (src MAC:筆電 dst MAC:???) ← 大信封，寫了快遞站
```

最外層是 [Ethernet frame](chunk://encapsulation)。最裡面是 HTTP 資料。拆封反過來：對面 server 收到 frame，一層一層拆掉 header，最後拿到 HTTP request。

<iframe src="https://jialin00.com/packets/goes-and-comes?phase=encapsulation" width="100%" height="500" style="border:none;" loading="lazy"></iframe>

但 IP header 裡填的目的地是 `93.184.216.34`，Ethernet header 卻要填目的地的 MAC，而筆電不知道 `93.184.216.34` 的 MAC。

---

## 找到下一跳的 MAC

筆電只需要下一跳的 MAC。`93.184.216.34` 不在區域網路裡，所以筆電查路由表：「目的地不在 `192.168.1.0/24`，送去 gateway `192.168.1.1`。」

那 `192.168.1.1` 的 MAC 是什麼呢？

這由 [ARP](chunk://arp) 查出來，一共四步：

1. 筆電廣播：「誰的 IP 是 `192.168.1.1`？告訴我 MAC。」
2. Gateway 回應：「我是 `192.168.1.1`，MAC 是 `AA:BB:CC:DD:EE:FF`。」
3. 筆電把 IP → MAC 存進 ARP table。下次不用再問。
4. Ethernet header 的 destination MAC 填上 gateway 的 MAC。

填的是 gateway 的 MAC，不是最終目的地 server 的 MAC。

<iframe src="https://jialin00.com/packets/goes-and-comes?phase=arp" width="100%" height="500" style="border:none;" loading="lazy"></iframe>

---

## 穿過第一台 Router

Frame 到了 gateway（家用路由器），路由器依序做這幾步：

1. **拆掉 L2。** 丟掉 Ethernet header，讀出 IP packet。
2. **查路由表。** 目的地 `93.184.216.34` 要往哪走？下一跳是 ISP 路由器 `203.0.113.1`。
3. **貼新的 L2。** source MAC 改成自己，destination MAC 改成 ISP 路由器的 MAC。

NAT 也發生在這一台。private IP `192.168.1.42` 被換成 router 的 public IP。ISP 看到的 source IP 不是筆電，是路由器。

封包出了家門。

<iframe src="https://jialin00.com/packets/goes-and-comes?phase=router" width="100%" height="500" style="border:none;" loading="lazy"></iframe>

---

## 一跳一跳往前

ISP 路由器收到 frame 之後做的步驟一模一樣：拆掉 L2、讀 L3、查路由表、貼新 L2、送出。

所以一路上 **IP 位址不變，Ethernet header 每一跳都換。** 例外是前面家用路由器做的 NAT，它換掉了 source IP。另外 IP header 裡的 TTL 每經過一台 router 會減 1，所以 header 本身不是完全沒動。

| | MAC | IP |
|---|---|---|
| 作用 | 找到下一站 | 找到最終目的地 |
| 變化 | 每一跳都換 | 不變（NAT 換掉 source IP 除外） |
| 比喻 | 轉機的登機證 | 護照上的目的地 |
| 層級 | L2 Data Link | L3 Network |

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

路由器只看兩層，L2 用來找下一跳，L3 用來決定往哪走。

<iframe src="https://jialin00.com/packets/goes-and-comes?phase=arrival" width="100%" height="500" style="border:none;" loading="lazy"></iframe>

---

## Debug 的時候，找哪一層壞了

連不上的時候，可以從下往上一層一層排查：

| 指令 | 測的層 | 問的問題 |
|---|---|---|
| `arp -a` | L2 | 知道 gateway 的 MAC 嗎？ |
| `ping 93.184.216.34` | L3 | 封包能不能到對面？ |
| `traceroute 93.184.216.34` | L3 逐跳 | 封包在哪一跳斷了？ |
| `curl https://api.example.com` | L7 | HTTP 有沒有問題？ |
| `openssl s_client -connect ...` | TLS | 憑證有沒有問題？ |

`ping` 通但 `curl` 不通？問題在 L4 以上。`ping` 不通？L3 或以下。`arp -a` 裡沒有 gateway？L2 出了問題。

### `arp -an` 輸出怎麼讀

`arp -an` 的輸出長這樣：

```text
? (192.168.0.1)   at fa:34:5a:6a:92:24  on en0 ifscope [ethernet]
? (192.168.0.96)  at b6:87:83:15:0a:1d  on en0 ifscope permanent [ethernet]
? (192.168.0.164) at f6:d9:fc:8a:68:d1  on en0 ifscope [ethernet]
? (224.0.0.251)   at 01:00:5e:00:00:fb  on en0 ifscope permanent [ethernet]
```

各欄位的意思：

- **`?`**：hostname 沒解析（`-n` 跳過反查）
- **`at MAC`**：學到的 MAC 位址
- **`on en0`**：從哪個介面學到的
- **`permanent`**：本機介面（自己的 IP）或 multicast group，永遠不過期
- 其他：動態學習的鄰居，會隨時間過期

所以上面標 `permanent` 的兩筆，`192.168.0.96` 是這台機器**自己的介面**，`224.0.0.251` 則是 mDNS 用的 multicast group。

### 為什麼沒連過的鄰居也在 cache 裡

跑 `arp -an` 常常會看到一堆這台機器從沒主動連過的 IP。這些紀錄有三種來源：

1. **mDNS / Bonjour 廣播**：Apple 裝置、智慧家電會定期 multicast 到 `224.0.0.251` 宣告自己的服務，這台機器被動收到，順便記下對方的 IP 跟 MAC
2. **鄰居送來的 ARP request**：鄰居要找這台機器的 MAC 時，request 裡帶著鄰居自己的 IP 跟 MAC，kernel 回應的同時也把對方記下來
3. **網路上的 broadcast**：DHCP、NetBIOS、SSDP 這類廣播封包帶著 sender 資訊，kernel 順便記下來

所以 ARP cache 裡大多數紀錄**不是主動查的**，是平常收到的廣播跟 ARP 問答順便留下的。

### 私密 MAC 的影響

現代裝置（尤其 Apple）會開啟 **MAC address randomization**：每個 WiFi network 用不同的隨機 MAC 替代硬體 MAC。這對 ARP 的直接影響：

- 同一台 iPhone 換 SSID（例如從 2.4G 切到 5G）可能換一個 MAC
- Router 的 ARP cache 和 DHCP client list 會出現「兩筆看起來不同但其實是同一台」的紀錄

第一個 byte 從右數第二個 bit 是 1，代表 **locally administered**（隨機生成）；是 0，代表廠商硬體位址：

```text
fa:34:5a:...  →  fa = 1111 1010 → 從右數第二位 = 1 → locally administered (隨機)
00:1b:63:...  →  00 = 0000 0000 → 從右數第二位 = 0 → 硬體 MAC (Apple OUI)
```

手機跟筆電預設開啟隨機 MAC 之後，家用網路上看到的 MAC 很多都是 locally administered。

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
                → 回應傳回來（回程不一定走同一條路）
```
