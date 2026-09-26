---
title: "封包怎麼知道下一個傳送點在哪"
slug: routing-journey
subtitle: "每台 router 只查自己的路由表決定下一跳。路由表由管理員手動寫，或由 OSPF、BGP 這類協議自動填。"
chapter: "networking"
tags: [as, bgp, igp, encapsulation, arp]
date: 2026-04-07
related: [packet-journey, dns-journey, security-journey]
---

# 封包怎麼知道下一個傳送點在哪

[Packet Journey](article://packet-journey) 裡每台 router 都是查路由表決定下一跳。那路由表是怎麼來的呢？router 怎麼知道去 `93.184.216.34` 要往哪個介面送？

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

每台 router 都有一張路由表，每一行記著「目的地在這個網段，就往這個介面送」。

```
Destination        Gateway         Interface
192.168.1.0/24     直連            eth0
10.0.0.0/8         203.0.113.1     eth1
0.0.0.0/0          203.0.113.1     eth1   ← default route
```

最後一行是 default route。意思是「不認識的目的地，統統送這裡」。家用路由器通常只有兩行：區域網路直連，其他全丟給 ISP。

ISP 邊界上的 router 會收下完整的全球路由表，有幾十萬行。

---

## 靜態 vs 動態

路由表可以手動寫（靜態），也可以讓 router 自己學（動態）。

**靜態路由：** 管理員手動設定。設定簡單、行為可預期，但網路拓撲一變就要手動改，適合小型又穩定的環境。

**動態路由：** Router 之間跑路由協議，互相交換路徑資訊，自動更新路由表，拓撲改變時也會自動收斂。大型網路只能用這種。

家用路由器用靜態。ISP 用動態。

---

## 自治系統：AS

網際網路由很多塊獨立管理的網路組成，每一塊叫一個 AS（Autonomous System）。

ISP 是一個 [AS](chunk://as)，大型企業也可能有自己的 AS，像 Google 就是 AS15169。

每個 AS 有一個編號（ASN）。AS 內部用內部路由協議（IGP）。AS 之間用外部路由協議（BGP）。

```
AS 100 (ISP A)          AS 200 (ISP B)          AS 15169 (Google)
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│  OSPF 內部   │──BGP──│  OSPF 內部   │──BGP──│  內部路由     │
│  路由協議     │        │  路由協議     │        │              │
└──────────────┘        └──────────────┘        └──────────────┘
```

AS 內部怎麼走，外面不需要知道。BGP 只交換「哪個 AS 能到哪個網段」。

---

## IGP：AS 內部怎麼選路

[IGP](chunk://igp)（Interior Gateway Protocol）是 AS 內部的路由協議。負責讓同一個組織內的 router 知道彼此的存在和路徑。

### RIP（Routing Information Protocol）

RIP 最老也最簡單，用 hop count 當成本。每經過一台 router 算一跳，目的地超過 15 跳就判定不可達。它是距離向量（distance vector）協議，每台 router 只知道鄰居報給它的距離，不知道整張網路長什麼樣。

```
A ──1 hop── B ──1 hop── C
A ──1 hop── D ──1 hop── C
```

A 到 C 有兩條路，都是 2 hop。RIP 認為一樣好。但如果 A→B 是 100 Mbps，A→D 是 10 Mbps 呢？RIP 不看頻寬，只數跳數。

適合中小型網路。大型網路 15 hop 限制太嚴格。

### OSPF（Open Shortest Path First）

OSPF 用 Dijkstra 最短路徑演算法。每條鏈路的成本預設由介面頻寬算出來，頻寬越大成本越低。

每台 router 都有整個區域的拓撲（link-state），不像 RIP 只知道鄰居報的距離，所以 OSPF 算得出整張圖上的最短路徑。

```
A ──cost 1── B ──cost 3── C    總 cost = 4
A ──cost 8── D ──cost 5── C    總 cost = 13
```

OSPF 選 A→B→C（cost 4）。RIP 認為兩條一樣（都是 2 hop）。

大型網路用 OSPF。它收斂得快，拓撲變了之後，所有 router 的路由表很快就更新成一致。它也支援 load balancing，還能把網路劃分成階層化的區域（Area）。

### EIGRP（Enhanced Interior Gateway Routing Protocol）

Cisco 開發的混合型協議，結合了距離向量跟鏈路狀態的做法。成本預設用頻寬跟延遲算，也可以設定成納入可靠度跟負載。

EIGRP 原本是 Cisco 專有的協議，2016 年以 RFC 7868 公開，但實務上幾乎只在 Cisco 設備上跑。

### IGP 比較

| 協議 | 類型 | 成本依據 | 適用場景 |
|---|---|---|---|
| RIP | 距離向量 | hop count（上限 15） | 中小型，教學 |
| OSPF | 鏈路狀態 | 頻寬為主 | 大型，業界主流 |
| EIGRP | 混合 | 頻寬 + 延遲 + 其他 | Cisco 環境 |
| IS-IS | 鏈路狀態 | 類似 OSPF | ISP 骨幹網 |

---

## BGP：AS 之間怎麼選路

[BGP](chunk://bgp)（Border Gateway Protocol）是 AS 之間的路由協議。整個網際網路的 AS 間路由靠 BGP 串起來。

BGP 選路看的不是距離，而是依序比較一串屬性。常見的有這幾個：

- **local preference**：AS 自己設定的偏好，數字大的優先，比 AS path 更早比較
- **AS path**：路徑經過了哪些 AS，越短越好
- **MED**：鄰居 AS 建議從哪個入口進來

沒有特別設定 local preference 的時候，結果通常由 AS path 長度決定。

### eBGP 和 iBGP

| | eBGP | iBGP |
|---|---|---|
| 場景 | 不同 AS 之間 | 同一個 AS 內部 |
| 作用 | 交換「哪個 AS 能到哪個網段」 | 把 eBGP 學到的路由散佈給 AS 內的 router |

為什麼 AS 內部還要跑 iBGP？因為 AS 邊界的 router 透過 eBGP 學到了外部路由，但 AS 內部其他 router 不知道。iBGP 負責把這些資訊傳進去。

那為什麼不用 IGP 傳 BGP 路由呢？因為 IGP 不是設計來存幾十萬條路由的。

所以 AS 內部的路由交給 IGP，跨 AS 的交給 BGP。

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

同一台 router 上如果同時跑 OSPF 和 BGP，用 Administrative Distance 決定誰優先。AD 數字越小越優先。OSPF 是 110，eBGP 是 20，所以 eBGP 學到的路由優先。

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

某一跳顯示 `* * *`，代表那台 router 沒有回 ICMP，可能是設定成不回，或是限制了回應的速率。封包本身不一定過不去。

---

## 當路由出問題

### 路由迴圈

A 認為去 C 要經過 B。B 認為去 C 要經過 A。封包在 A 和 B 之間彈來彈去，直到 TTL 歸零。

RIP 特別容易發生。OSPF 因為知道全域拓撲，幾乎不會。

### BGP hijack

AS 宣告了不屬於自己的網段。其他 AS 接受了這條路由，就把流量導過去。2018 年 4 月就出過一次：有人用 BGP hijack 劫持 Amazon Route 53 DNS 的網段，把連到 MyEtherWallet 的用戶導去假 server，偷走約 15 萬美元的以太幣（[事件分析](https://www.thousandeyes.com/blog/amazon-route-53-dns-and-bgp-hijack)）。

BGP 預設接受鄰居宣告的路由，不做驗證。RPKI（Resource Public Key Infrastructure）用簽章驗證宣告的 AS 是不是真的擁有那個網段，但還沒普及到所有 AS。

### 收斂時間

拓撲改變後，所有 router 更新路由表、達成一致的時間叫收斂。OSPF 幾秒。RIP 可能幾分鐘。收斂期間封包可能走錯路或被丟掉。

---

## 回到 Packet Journey

Packet Journey 裡 router 查的那張路由表，小型網路靠管理員手動寫，大型網路靠 OSPF、BGP 自動學。
