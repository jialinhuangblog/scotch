---
title: "Encapsulation"
slug: encapsulation
brief: "資料從 App 到網卡，每一層加 header。Frame、Packet、Segment 就是這樣來的。"
article: packet-journey
date: 2026-04-07
updated: 2026-10-18
revisions: 2
---

# Encapsulation

送出去的 HTTP request 不會原封不動抵達對面。每一層網路協議都會把它包起來，加上自己的 header，再交給下一層。

拿一個最小的請求走一遍。筆電（IP 192.168.1.20）對 api.example.com（IP 93.184.216.34）送 `GET /orders`。

App 層交出去的是純文字，`GET /orders HTTP/1.1` 加上幾行 header，假設 200 bytes。這裡用不加密的 http（port 80），因為 https 會在 HTTP 跟 TCP 中間多一層 TLS，TCP 收到的就是加密過的 TLS record，不再是這段純文字，長度也會多出 TLS 自己的 header 跟認證資料。

TCP 層在前面加 20 bytes 的 TCP header，裡面寫著 source port 51234、destination port 80、sequence number 1001。加完這一包叫 segment。TCP 只管「哪個 process 對哪個 process」跟「這是第幾段」，不知道對方在哪台機器。

IP 層再往前加 20 bytes 的 IP header，寫著 source IP 192.168.1.20、destination IP 93.184.216.34。這一包叫 packet。IP 管「哪台機器到哪台機器」，但不知道下一跳怎麼走。

Ethernet 層最後加 14 bytes 的 header，寫著 source MAC 是筆電網卡、destination MAC 是家用路由器的網卡。不是對面 server 的 MAC，因為 Ethernet 只能送到同一條線上的下一台。尾端再加 4 bytes 的 FCS 校驗碼。這一包叫 frame，總共 258 bytes，從網卡送出去。

```text
| Ethernet 14 | IP 20 | TCP 20 | GET /orders ... 200 | FCS 4 |
|<-------------------- frame 258 bytes -------------------->|
              |<---------- packet 240 ---------->|
                      |<----- segment 220 ----->|
```

## 每一層只看自己的 header

家裡的路由器收到 frame，看 destination MAC 是自己，拆掉 Ethernet header 跟 FCS，露出 IP header。destination IP 93.184.216.34 不是自己，查路由表決定下一跳，再包一層新的 Ethernet header，destination MAC 換成 ISP 那邊的設備。HTTP 內容它碰都不碰。

家用路由器還多做一件事。192.168.1.20 是私有位址，internet 上的 router 不認得，回應送不回來，所以它做 [NAT](chunk://nat-gateway)：把 source IP 換成自己的公有 IP（假設 203.0.113.7），source port 51234 也可能換成另一個，記在 NAT 表裡，回應進來時才知道要轉給哪台筆電。IP 跟 port 改了，IP header 跟 TCP header 裡的 checksum 也要跟著重算。

出了家門之後，internet 上的每一台 router 只重做前面那段動作：拆 Ethernet header、查路由表、包新的 Ethernet header。所以 Ethernet header 每一跳換一次，IP header 裡的來源（已經是 203.0.113.7）跟目的地一路不變。

中間的 switch 更省事，只看 Ethernet header 的 MAC，連 IP header 都不拆。

## 拆封

server 收到 frame，反過來做。去掉 Ethernet header 得到 packet，去掉 IP header 得到 segment，看 destination port 80 交給監聽 80 的 process，去掉 TCP header，剩下的 200 bytes 就是原本的 `GET /orders`。
