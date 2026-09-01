---
title: "STUN / TURN"
slug: stun-turn
brief: "STUN 照出自己的公開地址，兩個 NAT 後面的人就能直連；穿不過去，退到 TURN 中繼。"
date: 2026-07-12
article: webrtc-nat-traversal
---

# STUN / TURN

> 兩個瀏覽器都在 NAT 後面，沒有公開地址，WebRTC 要直連，地址從哪來？

## STUN：照出自己的公開地址

STUN 只回答一個問題：「我在外界看起來是什麼地址？」兩邊各自問到，透過 signaling 交換，然後同時往對方送封包。NAT 記下這筆對外連線，對方回來的封包就放行，這一招英文叫 hole punching。多數家用路由器這樣就通了。

STUN 給完地址就退場，媒體流不經過它。

## TURN：穿不過去時的中繼

對稱型 NAT 每換一個目標就換 port，STUN 問到的地址轉手給對方就失效，直連建不起來。這時退到 TURN：它在自己身上開一個中繼地址，兩邊都送到那裡，由它代轉。

代價是 TURN 全程留在資料路徑上，代轉所有流量，所以貴。callstats.io 監測數十億分鐘通話的統計：22% 的會議需要 TURN。

差別就在資料路徑：STUN 不在路徑上，TURN 全程都在。能直連就直連，TURN 只接剩下的。
