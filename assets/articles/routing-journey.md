---
title: "封包怎麼知道下一個傳送點在哪"
slug: routing-journey
subtitle: "每台 router 都只知道下一步，全程沒人有完整地圖。"
chapter: "networking"
tags: [as, bgp, igp, encapsulation, arp]
date: 2026-04-07
related: [packet-journey, dns-journey, security-journey]
---

# 封包怎麼知道下一個傳送點在哪

[Packet Journey](article://packet-journey) 裡每台 router 做的事很簡單：查路由表，決定下一跳。但路由表怎麼來的？誰告訴 router「去 `93.184.216.34` 要往左邊走」？

這篇回答這件事。

這趟旅程會經過這些 protocol：

| Protocol | 層級 | 做什麼 | 出場時機 |
|---|---|---|---|
| IP | L3 Network | 封包的地址系統 | 全程 |
| ICMP | L3 Network | traceroute、TTL 回報 | 路徑探測 |
| RIP | L3 Network | 距離向量路由 | 小型網路內部 |
| OSPF | L3 Network | 鏈路狀態路由 | 大型網路內部 |
| BGP | L3 Network | 自治系統之間的路由 | 跨 ISP |
| EIGRP | L3 Network | Cisco 混合路由 | Cisco 環境 |

---

## 路由表長什麼樣

每台 router 有一張表。每一行說：「目的地在這個網段，往這個介面送。」

```
Destination        Gateway         Interface
192.168.1.0/24     直連            eth0
10.0.0.0/8         203.0.113.1     eth1
0.0.0.0/0          203.0.113.1     eth1   ← default route
```

最後一行是 default route。意思是「不認識的目的地，統統送這裡」。家用路由器通常只有兩行：區域網路直連，其他全丟給 ISP。

ISP 的 router 路由表有幾十萬行。全球的路由資訊都匯聚在這裡。

---

## 靜態 vs 動態

路由表可以手動寫（靜態），也可以讓 router 自己學（動態）。

**靜態路由：** 管理員手動設定。簡單，可控，但網路拓撲一變就要手動改。適合小型、穩定的環境。

**動態路由：** Router 之間跑路由協定，互相交換路徑資訊，自動更新路由表。拓撲改變時自動收斂。大型網路唯一的選擇。

家用路由器用靜態。ISP 用動態。

---

## 自治系統：AS

整個網際網路不是一張扁平的大網。它被切成一塊一塊，每一塊叫一個 AS（Autonomous System）。

一個 [AS](chunk://as) 就是一個獨立管理的網路。ISP 是一個 AS。大型企業可能有自己的 AS。Google 有自己的 AS（AS15169）。

每個 AS 有一個編號（ASN）。AS 內部用內部路由協定（IGP）。AS 之間用外部路由協定（BGP）。

```
AS 100 (ISP A)          AS 200 (ISP B)          AS 15169 (Google)
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│  OSPF 內部   │──BGP──│  OSPF 內部   │──BGP──│  內部路由     │
│  路由協定     │        │  路由協定     │        │              │
└──────────────┘        └──────────────┘        └──────────────┘
```

AS 內部怎麼走，外面不需要知道。BGP 只交換「哪個 AS 能到哪個網段」。

---

## IGP：AS 內部怎麼選路

[IGP](chunk://igp)（Interior Gateway Protocol）是 AS 內部的路由協定。負責讓同一個組織內的 router 知道彼此的存在和路徑。

### RIP（Routing Information Protocol）

最老，最簡單。用 hop count 當成本。每經過一台 router 算一跳。目的地超過 15 跳就判定不可達。

```
A ──1 hop── B ──1 hop── C
A ──1 hop── D ──1 hop── C
```

A 到 C 有兩條路，都是 2 hop。RIP 認為一樣好。但如果 A→B 是 100 Mbps，A→D 是 10 Mbps 呢？RIP 不看頻寬，只數跳數。

適合中小型網路。大型網路 15 hop 限制太嚴格。

### OSPF（Open Shortest Path First）

用 Dijkstra 最短路徑演算法。成本不只看跳數，還看頻寬、延遲。

每台 router 知道整個區域的拓撲（link-state）。不像 RIP 只知道鄰居告訴它的距離。OSPF 算的是真正的最短路徑。

```
A ──cost 1── B ──cost 3── C    總 cost = 4
A ──cost 8── D ──cost 5── C    總 cost = 13
```

OSPF 選 A→B→C（cost 4）。RIP 認為兩條一樣（都是 2 hop）。

大型網路用 OSPF。收斂快，支援 load balancing，支援階層化區域（Area）劃分。

### EIGRP（Enhanced Interior Gateway Routing Protocol）

Cisco 開發。混合型：結合距離向量和鏈路狀態。看頻寬、延遲、可靠度、負載。

只在 Cisco 設備上跑。不是開放標準。

### 三者的差別

| 協定 | 類型 | 成本依據 | 適用場景 |
|---|---|---|---|
| RIP | 距離向量 | hop count（上限 15） | 中小型，教學 |
| OSPF | 鏈路狀態 | 頻寬為主 | 大型，業界主流 |
| EIGRP | 混合 | 頻寬 + 延遲 + 其他 | Cisco 環境 |
| IS-IS | 鏈路狀態 | 類似 OSPF | ISP 骨幹網 |

IGP 解決的是「同一個 AS 內部，封包怎麼走最快」。

---

## BGP：AS 之間怎麼選路

[BGP](chunk://bgp)（Border Gateway Protocol）是 AS 之間的路由協定。整個網際網路的 AS 間路由靠 BGP 串起來。

BGP 不選最短路徑。它選「最佳路徑」，依據是一串屬性：AS path 長度、local preference、MED、origin type。最重要的通常是 AS path — 經過的 AS 越少越好。

### eBGP 和 iBGP

| | eBGP | iBGP |
|---|---|---|
| 場景 | 不同 AS 之間 | 同一個 AS 內部 |
| 作用 | 交換「哪個 AS 能到哪個網段」 | 把 eBGP 學到的路由散佈給 AS 內的 router |

為什麼 AS 內部還要跑 iBGP？因為 AS 邊界的 router 透過 eBGP 學到了外部路由，但 AS 內部其他 router 不知道。iBGP 負責把這些資訊傳進去。

為什麼不用 IGP 傳 BGP 路由？IGP 不是設計來處理幾十萬條路由的。BGP 路由表很大，IGP 扛不住。

所以分工很清楚：IGP 管 AS 內部誰連到誰，BGP 管跨 AS 的路由，兩者各走各的表。

---

## 最佳路徑怎麼選

Router 到一個目的地可能有多條路。選路的依據不只一個：

| 因素 | 說明 |
|---|---|
| hop count | 經過幾台 router（RIP 用這個） |
| 頻寬 | 鏈路速度（OSPF、EIGRP 用這個） |
| 延遲 | 封包走這條路要多久 |
| 可靠度 | 這條鏈路的丟包率 |
| AS path 長度 | 經過幾個 AS（BGP 用這個） |
| 管理員權重 | 手動偏好，覆蓋一切 |

同一台 router 上如果同時跑 OSPF 和 BGP，用 Administrative Distance 決定誰優先。OSPF 的 AD 是 110，eBGP 是 20。BGP 優先。

---

## TTL 和 traceroute

IP header 裡有個 TTL 欄位（Time To Live）。每經過一台 router，TTL 減 1。減到 0，router 不轉發，丟掉封包，並送回一個 ICMP Time Exceeded 訊息。

`traceroute` 利用這個機制：

1. 送出 TTL=1 的封包。第一台 router 減到 0，回 ICMP。得知第一跳的 IP。
2. 送出 TTL=2 的封包。第二台 router 減到 0，回 ICMP。得知第二跳的 IP。
3. 重複，直到目的地回應。

```bash
traceroute 93.184.216.34
 1  192.168.1.1      1.234 ms   ← 家用路由器
 2  203.0.113.1      5.678 ms   ← ISP
 3  198.51.100.1    12.345 ms   ← 中繼
 4  93.184.216.34   18.901 ms   ← 到了
```

某一跳顯示 `* * *`？那台 router 擋了 ICMP。不代表封包過不去，只是那台不回應。

---

## 當路由出問題

### 路由迴圈

A 認為去 C 要經過 B。B 認為去 C 要經過 A。封包在 A 和 B 之間彈來彈去，直到 TTL 歸零。

RIP 特別容易發生。OSPF 因為知道全域拓撲，幾乎不會。

### BGP hijack

AS 宣告了不屬於自己的網段。其他 AS 信了，把流量導過去。2018 年 4 月就出過一次：有人用 BGP hijack 劫持 Amazon Route 53 DNS 的網段，把打 MyEtherWallet 的用戶導去假 server，偷走約 15 萬美元的以太幣（[事件分析](https://www.thousandeyes.com/blog/amazon-route-53-dns-and-bgp-hijack)）。

BGP 建立在信任之上。RPKI（Resource Public Key Infrastructure）試圖用簽章解決，但採用率還在爬。

### 收斂時間

拓撲改變後，所有 router 更新路由表、達成一致的時間叫收斂。OSPF 幾秒。RIP 可能幾分鐘。收斂期間封包可能走錯路或被丟掉。

---

## 回到 Packet Journey

Packet Journey 裡 router 查的那張路由表，不是天生的。小型網路靠管理員手動寫。大型網路靠 OSPF、BGP 自動學習。

封包不知道全程的路。每台 router 只知道下一跳。但透過路由協定，每台 router 的「下一跳」串起來，就是一條完整的路徑。
