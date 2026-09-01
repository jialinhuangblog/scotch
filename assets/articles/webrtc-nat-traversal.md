---
title: "視訊通話為什麼不走 server：WebRTC 的 P2P、signaling、和 NAT 穿透"
slug: webrtc-nat-traversal
date: 2026-07-07
subtitle: "WebSocket 什麼都過 server，WebRTC 讓瀏覽器直連，server 只牽線。牽線之後，兩個躲在 NAT 後面的瀏覽器怎麼找到對方。"
chapter: "networking"
tags: [webrtc, nat, stun, turn, p2p, signaling, realtime]
related: [message-system-axes, http-realtime-pushing, why-udp]
---

# 視訊通話為什麼不走 server：WebRTC 的 P2P、signaling、和 NAT 穿透

[WebSocket](chunk://websocket)、[SSE](chunk://sse)、SignalR，這些即時通訊全是同一個形狀：client 到 server，訊息都經過自己的 server。

視訊通話不用它們。為什麼？

因為如果每一幀影像都經過 server 中轉，會發生兩件事：延遲多一跳，而且所有人的影像流量都算在這台 server 的頻寬帳單上。一場十人會議，server 進十路、出九十路，這條路很快就變成瓶頸。

WebRTC 換了拓撲。

---

## 一場通話同時跑兩套協定

一場視訊通話其實同時跑兩套協定，一套走 TCP、一套走 UDP，各管各的：

| | 牽線、聊天、通知（可靠優先） | 音視訊媒體（即時優先） |
|---|---|---|
| L7 應用層 | WebSocket / SSE / HTTP | SRTP、DTLS、SCTP、STUN/TURN/ICE |
| L4 傳輸層 | TCP：掉包重傳，保證送到 | UDP：掉包就丟，不等 |
| L3 網路層 | IP | IP |

右邊那四個各自管什麼：

- **SRTP**：音視訊本體，RTP 的加密版
- **DTLS**：TLS 的 UDP 版，握手、交換加密金鑰
- **SCTP**：DataChannel 走這，包在 DTLS 裡
- **STUN / TURN / ICE**：建線工具，媒體通了就退場（TURN 例外，留在路徑上中繼）

媒體那邊堅持 UDP，因為 TCP 掉包會重傳，重傳期間後面的封包全部排隊等。視訊掉一格，重傳回來早就過時了，不如丟掉往前播。寧可掉包，不要排隊。

這篇接下來講的 WebRTC，就是右邊那疊。左邊 TCP 那條也沒退場，牽線（signaling）靠的還是它，馬上講到。

---

## 從 server 中轉，改成瀏覽器直連

```
WebSocket / SignalR：  瀏覽器 A → server → 瀏覽器 B   （什麼都過 server）
WebRTC：              瀏覽器 A ─────────→ 瀏覽器 B   （直連，server 不在資料路徑上）
```

直連就是最短路徑，延遲最低，server 不碰媒體流。WebRTC 是為即時媒體生的，音訊、視訊。

但直連馬上撞到一個問題：兩個瀏覽器，怎麼知道對方在網路上的哪裡？

---

## 牽線：signaling 這段，你自己蓋

瀏覽器躲在 NAT（[Network Address Translation](chunk://nat-gateway)）和防火牆後面，沒有公開地址。A 根本不知道 B 在哪。所以連線之前要一段牽線，交換「我在哪、我支援什麼編碼」。這個過程叫 signaling。

**WebRTC 不規定 signaling 怎麼做，要自己實作。** 用什麼做？通常就是 WebSocket 或 SignalR。

```
A ── WebSocket ──→ server ── WebSocket ──→ B    先用 server 幫兩邊互報家門
A ←──────────── 直連 P2P ──────────────→ B    牽好線後，媒體走這條，server 退場
```

所以 WebRTC 不是取代 WebSocket，是接在它後面。這裡不是協定包裝（WebRTC 沒有跑在 WebSocket 裡面），是兩條獨立連線的接力：先開一條 WebSocket（TCP）牽線，再開一條 WebRTC（UDP）走媒體，兩條並存、互不包含。signaling 那一段還是「什麼都過 server」的老路，握手完成、直連建立之後，影像才不再經過 server。這也接回 [訊息系統那四個問題](article://message-system-axes)：signaling 站在「最後一哩」那一層，WebRTC 只是把拓撲從 server 到 client，改成 client 到 client。

---

## STUN：一面鏡子，照出你的公開地址

牽線要工具。第一個叫 STUN。

STUN 只做一件事：client 問「我在外界看起來是什麼地址」，它照看到的來源位置回覆。一問一答，一個來回，像照鏡子。照完就走，之後的媒體流不經過 STUN。

問到地址之後，A 和 B 同時往對方的地址送封包，讓各自的 NAT 願意放行對方。這一招英文叫 hole punching：

A、B 都在 NAT 後面，這是常態，不是例外：

- A 問 STUN：我的公開地址是什麼？得到 `1.2.3.4:5000`。
- B 問 STUN：得到 `6.7.8.9:6000`。
- 兩人透過 signaling 交換這兩個地址。
- A 送一個封包給 B。NAT 記下這筆對外連線，之後從 B 那個地址回來的封包就放行。
- 兩邊同時做這件事，直連通道成立。

兩邊都在 NAT 後面，STUN 一樣能成。 只要 NAT 是「好講話」的那種，送封包時對外開的那個 port 對誰都通用，B 拿 A 交換來的地址就連得進來。

多數家用路由器是這種。所以大部分連線，STUN 就夠了。

---

## 對稱 NAT：讓 STUN 照到的地址失效

有一種 NAT 比較機車，叫對稱型（symmetric NAT）。它連不同目標，對外給你不同的 port。

這下 STUN 照到的地址騙人：

- A 問 STUN，NAT 開了 `1.2.3.4:5000`。這是「連 STUN」用的 port。
- STUN 誠實回覆：A 的地址是 `1.2.3.4:5000`。
- 但 A 真的要連 B 時，NAT 看到目標換了，另開 `1.2.3.4:5005`。
- A 給 B 的是 `:5000`，B 打過去撲空，因為那個 port 只收 STUN 的回覆。
- 而真正對 B 開的 `:5005`，B 根本不知道。

STUN 沒有隱瞞什麼，它照到的地址是真的。問題是那個地址只對 STUN 有效，換個對象就過期。地址對，但不能轉手給別人用，穿透失敗。

這時才需要第二個工具。

---

## TURN：穿不過去時的中繼

TURN 的解法不是想辦法找出真實位置，是乾脆不靠這個位置了。它撥一個「自己身上」的公開地址給 client，請對方送到那裡，TURN 再轉進來。

- A 向 TURN 要一個中繼地址。
- TURN 回覆：用 `9.9.9.9:60000`（這是 TURN 上的 port，不是 A 家的）。
- A 透過 signaling 告訴 B：來 `9.9.9.9:60000` 找我。
- B 送到 `9.9.9.9:60000`，TURN 轉發給 A。

跟 STUN 最大的差別：**TURN 一直待在資料路徑上**，每一封都經過它轉。STUN 給完地址就走，TURN 全程中繼。這也是 TURN 貴的原因，它要代轉全部的媒體流量。

那 TURN 看得到通話內容嗎？看得到「有封包在流、多大、多頻繁」，BUT，看不到內容。WebRTC 的媒體是端對端加密的，TURN 轉的是一包包加密資料，它沒有鑰匙。像郵差：信經它的手、知道誰跟誰在通信，但信封是封死的，拆不開。

---

## 到底多少連線需要 TURN

[callstats.io 發表在 webrtcHacks 的統計](https://webrtchacks.com/usage-stats/)：監測 2015 到 2016 年、100 家以上客戶、數十億分鐘的通話，「22% 的會議需要某種 TURN 中繼」。另外約 9% 需要走 TCP，而整體有 12% 的 session 根本建不起來，其中 85% 的失敗敗在無法穿透 NAT 或防火牆。

所以架構上的取捨很清楚：盡量讓 STUN 直連，TURN 只接那漏網的兩成。TURN 是保底，不是常態，但沒有它，那兩成連不上的人就是連不上。

---

## 多人通話：純 P2P 到十個人就不行

兩人直連很漂亮。但 N 個人全部互連，是 N² 條連線，每個人都要上傳 N-1 路。十人會議，每人上傳九路，家用網路的上傳頻寬不夠。

所以群組通話實務上又擺一台媒體 server，叫 SFU（Selective Forwarding Unit）：每人只上傳一份給 SFU，SFU 轉發給其他人。

```
1 對 1：      純 P2P 直連
多人：        每人 → SFU → 其他人（server 只轉發，不轉碼）
```

嚴格說這時候不是 P2P 了，server 又回到路徑上。但 SFU 跟 TURN 是兩回事：TURN 是搬運工，封包原封繞過去，加密金鑰在兩端手上，它解不開內容，連線邏輯上還是你跟對方；SFU 是每條連線的終點，每個人跟它各建一條完整的 WebRTC 連線，加密在它這裡終止，它看得懂媒體，才有辦法挑著轉發。它比「server 幫每個人轉碼」的老架構輕，但比 TURN 重得多。

---

## P2P 和 SFU，走的協定一樣嗎

一樣，就是開頭那張圖右邊那疊。SFU 自己是一個 WebRTC endpoint，對每個 client 各跑一套 ICE、DTLS、SRTP，收到封包挑著轉發。P2P 換 SFU，改的是跟誰連，不是用什麼協定。

UDP 被防火牆全擋的時候才降級：TURN 能退到 TCP、再退到 TLS 443（有些企業防火牆只放行 443，這是最後一條活路），前面統計裡「9% 需要走 TCP」就是這批。降級的代價就是開頭講的排隊，畫面會頓。

---

## 所以 WebRTC 取代了 WebSocket 嗎

WebRTC 還是「最後一哩」那一層，但拓撲從 server 到 client，變成 client 到 client。server 的角色縮成媒婆：牽線（signaling）加上 STUN、TURN 保底。

而牽線那一段，正是 WebSocket 或 SignalR 的活。所以 WebRTC 不是取代前面那些即時通訊，是接在它們後面：用 WebSocket 牽線，用 WebRTC 走媒體，兩條連線一條 TCP、一條 UDP，各自獨立。

要低延遲的音訊視訊，用 WebRTC 直連。要可靠的 server 中轉訊息，用 WebSocket。兩個常常一起用，一個負責牽線、一個負責走媒體。
