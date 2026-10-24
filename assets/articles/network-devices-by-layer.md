---
title: "拆封包拆到第幾層，決定它是什麼設備"
slug: network-devices-by-layer
subtitle: "hub 不讀地址，switch 跟 AP 讀 MAC，router 讀 IP。core switch 跟 AP 同在 L2，core switch 掛掉會讓站內大片區域失聯，AP 掛掉只斷連著它的那幾台。"
chapter: "networking"
tags: [networking, osi, switch, router, ap, topology]
date: 2026-07-04
related: [packet-journey, lb-l4-l7-lab]
---

# 拆封包拆到第幾層，決定它是什麼設備

同一條網路線，流過的是同一串位元。但 switch 只讀最外層的 MAC 位址，router 還會再往裡拆一層讀 IP 位址，所以兩台對這串位元做的事完全不同。

## 封包怎麼包

一個封包是[好幾層包起來](chunk://encapsulation)的。最外層是 L2 的框（frame），裡面包著 L3 的封包（packet），再裡面是 L4 的段（segment），最內層才是應用程式的資料。

每一層的外皮（header）上，都寫著那一層的地址。L2 的皮上是 [MAC 位址](chunk://arp)，L3 的皮上是 IP 位址，L4 的皮上是 port。

一台設備「工作在第幾層」，意思就是：**它拆到第幾層的皮，讀那層的地址來做決定**。讀得越深的設備能做越複雜的判斷，處理也越慢。網路設備就是照這個分類的。

## 每台設備拆到第幾層

**Hub，L1。** 它一層皮都不拆。一個孔進來的訊號，原封不動複製到其他每個孔。因為它不讀地址，接在上面的每台設備都會收到。現在已經淘汰了，這裡拿來當對照。

**Switch，L2。** 它拆最外面那層皮，讀 MAC 位址。它維護一張 MAC table，記著哪個 MAC 接在哪個孔，所以封包進來只會送到對的孔，其他孔收不到。但它只管同一個區網內部，封包送不出這個區網。辦公室裡兩台電腦互傳檔案，走的就是 switch。

**AP，L2。** 它其實是一台無線版的 switch，負責把 WiFi 的無線框（802.11）轉成有線的乙太框（802.3），反過來也一樣。它一樣讀 MAC，也一樣不做路由。所以純 AP 跟 switch 在同一層，差在一邊接無線、一邊接有線。

**Router，L3。** 它拆到第二層皮，讀 IP 位址。IP 才有跨網路的概念，所以 router 負責在不同網路之間轉送，決定封包的下一跳往哪走。辦公室連到 internet 要經過的就是 router。[一個封包的旅程](article://packet-journey)講的就是 router 之間怎麼轉送。

**L3 switch。** 它是多了路由功能的 switch，同時讀 MAC 跟 IP。區網內用 L2 快速轉送，跨網段時才用 L3 路由。大型內網的骨幹常用這種。

**Firewall，L3/L4 以上。** 它讀 IP 加 port（[L4](chunk://l4-vs-l7-lb)），判斷這個封包要放行還是丟掉。次世代防火牆還會拆到 L7，看應用層的內容。它裝在那裡是為了過濾封包，轉送不是它的主要工作。

**Gateway 是角色，不是層級。** gateway 指的是一個網路對外的出口，通常由 router 兼任。所以 gateway 講的是它在網路邊界上的位置，跟 OSI 第幾層無關。

家裡那台「WiFi 分享器」其實是把 router、switch、AP **三台設備塞進一個盒子**，所以才容易以為它們是同一種設備。企業環境裡，這三台通常是分開的。

## 第二個維度：它擺在哪

OSI 層講的是「這台設備能做什麼決策」。但拓撲圖上還有另一種等級，講的是「它擺在哪、掛掉會牽連多少人」。

企業網路由外而內，大致是這樣一條鏈：

```
internet
  │
gateway / firewall     邊界，對外唯一出口
  │
core switch / router   核心，站內骨幹
  │
access switch          接入層，牆上網孔
  │
AP                     把無線裝置接進來
  │
client                 端點，不轉發任何人
```

越多設備的連線要經過它，它掛掉牽連的範圍越大。但牽連的**種類**不一樣。

gateway 掛了，整站連不出去，但站內設備彼此還通，因為內部流量根本不經過 gateway。core switch 掛掉比較嚴重。它是站內的必經點，所以它一斷內部大片區域就失聯。一台 AP 掛了只影響連它的那幾台無線裝置，範圍最小。

所以影響大小看的是**有多少設備的連線要經過它**，不是它在多上游。gateway 是對外的必經點，core switch 是對內的必經點。

## 越上游的設備，OSI 層越高嗎

不會。core switch 在站內骨幹，AP 在最邊緣，兩台都工作在 L2。gateway 在最上游，也只到 L3。

- **OSI 層**決定這台設備讀得懂什麼、能做什麼判斷：用 MAC 還是 IP，能不能過濾，能不能跨網段。
- **拓撲位置**決定它掛掉時有多少設備跟著斷線，維運告警也照這個位置來收斂。

## 判斷一台設備的兩個問題

讀 MAC 的是 switch 跟 AP，讀 IP 的是 router，讀到 port 以上的是 firewall。

同樣是 L2，AP 掛了只斷連著它的那幾台無線裝置，core switch 掛了站內大片區域一起失聯。gateway 掛了，站內照樣互通，只是整站連不出去。
