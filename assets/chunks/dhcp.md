---
title: "DHCP (Dynamic Host Configuration Protocol)"
slug: dhcp
brief: "接到新網路幾秒後就有 IP。DHCP 的 DORA 四步驟做了這件事。"
article: packet-journey
date: 2026-04-11
updated: 2026-07-20
revisions: 1
---

# DHCP (Dynamic Host Configuration Protocol)

你把筆電接到新的 WiFi 或插上網路線，幾秒後就有 IP，沒有人手動設定。這個自動分配 IP 的機制就是 DHCP。

## DORA 四步驟

Client 和 server（通常是 router）之間的四次對話：

```text
1. DISCOVER  Client 廣播: "誰能給我 IP？"
2. OFFER     Server → Client: "給你 192.168.0.96，lease 24 小時"
3. REQUEST   Client 廣播: "我要 192.168.0.96（server X 提供的那個）"
4. ACK       Server → Client: "OK，這個 IP 歸你，lease 開始"
```

前兩步是 broadcast（client 還沒有 IP，不知道 server 在哪；server 看到後主動回應）。第三步也是 broadcast，讓其他可能存在的 DHCP server 知道「我已經選了一家，別再給我 offer」。第四步收到 ACK 後 client 才真正能用這個 IP。

## 拿到的不只是 IP

DHCP OFFER 裡打包了好幾樣東西：

| 項目 | 範例 | 用途 |
|---|---|---|
| IP address | `192.168.0.96` | 你的位址 |
| Subnet mask | `255.255.255.0` (`/24`) | 定義 LAN 範圍 |
| Default gateway | `192.168.0.1` | 送出網段的封包交給誰 |
| DNS server | `8.8.8.8` 或 router 自己 | 查網域要問誰 |
| Lease time | `86400` 秒 | 這個 IP 可以用多久 |

沒有 gateway 就出不了 LAN、沒有 DNS 就解不了網域、沒有 lease time 就不知道什麼時候續約。所以你接一次網路，這些東西 DHCP 一個 OFFER 全給你，不用自己一項一項設。

## Lease 到期怎麼辦

DHCP 的 IP 有效期通常 24 小時到 7 天。到期不是一次到位，分兩個時間點提前動作：

- **50% (T1)**：主動跟原 server 續約（送 `DHCPREQUEST`）
- **87.5% (T2)**：原 server 沒回應，改廣播找任何 server
- **完全到期**：重來一次 DISCOVER

這是為什麼重啟 router 後家裡裝置的 private IP 可能會變（例如 `192.168.0.96` 變成 `192.168.0.12`），router 的 lease 紀錄沒了，重新 DISCOVER 時分配到不同的位址。注意這裡變的是 `192.168.0.n` 的 n，由你家 router 的 DHCP server 決定。Router 本身的 public IP（ISP 給的）是另一層 DHCP，由 ISP 控制，跟你重啟 router 通常無關。

## Static Reservation：固定 IP

Router 管理介面可以設「這個 MAC 永遠給這個 IP」：

```text
MAC: b6:87:83:15:0a:1d  →  IP: 192.168.0.96  (reserved)
```

DORA 四步驟照跑，只是 server 在 OFFER 階段查到這個 MAC 有 reservation，直接回傳指定的 IP。Client 完全感覺不出差別。

適用場景：家裡的 NAS、印表機、IoT hub 希望 IP 穩定，port forwarding 和書籤才不會失效。

## 實務觀察：為什麼 client list 看起來有重複

DHCP server 以 **MAC 為 key** 記 lease，每出現新 MAC 就當新裝置記一筆。現代裝置開了 [私密 MAC](chunk://arp) 後會輪換 MAC，router 從 MAC 看不出它們是同一台，家裡 5 台裝置在 client list 上變成 15 筆是正常的。

## DHCP 和 ARP 的分工

兩個常被混淆，其實職責不同：

| | DHCP | [ARP](chunk://arp) |
|---|---|---|
| 解決什麼 | 我還沒有 IP，誰能給我 | 我知道 IP，怎麼找到對應的 MAC |
| 何時觸發 | 接入網路當下 + 定期續約 | 每次要送 frame 到新鄰居 |
| 範圍 | LAN（通常 router 是 server） | LAN |
| 協定位置 | UDP port 67/68，應用層 | L2，沒有 IP header |

順序：**DHCP 先把你放進網路**（給你 IP），**ARP 才在網路裡幫你找鄰居**（IP → MAC）。
