---
title: "BGP (Border Gateway Protocol)"
slug: bgp
brief: "AS 之間的路由協定。整個網際網路的路由靠它串起來。"
article: routing-journey
date: 2026-04-08
updated: 2026-07-20
revisions: 3
---

# BGP (Border Gateway Protocol)

你從台灣連 GitHub。封包要經過中華電信的 AS、跨太平洋到某個 transit AS、再到 GitHub 的 AS。誰告訴這些 AS 該往哪轉？BGP。

BGP 是 AS 之間的路由協定。每個 AS 的邊界 router 透過 BGP 互相通告：「我能到這些網段，經過這些 AS。」

## 一個封包怎麼找到 GitHub

```text
你的封包 → 中華電信 (AS3462)
  AS3462 的 BGP 表：
    GitHub 140.82.112.0/20 → 兩條路：
      路徑 A: AS3462 → AS1299 (Telia) → AS36459 (GitHub)     2 hop
      路徑 B: AS3462 → AS4637 → AS1299 → AS36459 (GitHub)   3 hop
    選路徑 A（AS path 較短）
```

BGP 不像 OSPF 算頻寬最短路徑。BGP 選的是「經過最少 AS」的路。AS path 是最常用的選路依據。

## eBGP vs iBGP

```text
          eBGP                eBGP
AS3462 ────────── AS1299 ────────── AS36459
 R1 ── R2          R3 ── R4          R5
   iBGP               iBGP
```

**eBGP**：不同 AS 的邊界 router 之間。AS3462 的 R2 和 AS1299 的 R3 跑 eBGP，交換「我的 AS 能到哪些網段」。

**iBGP**：同一個 AS 內部。R2 透過 eBGP 從 R3 學到「GitHub 的 `140.82.112.0/20` 往右走可以到」。但 R1 沒跟 R3 建 eBGP，R1 不知道這件事。iBGP 讓 R2 把這條外部路由告訴 R1：「要去 GitHub，把封包交給我，我知道往哪轉。」

iBGP 不是 IGP。IGP 解決「R1 到 R2 內部怎麼走」（哪條 link、哪個介面）。iBGP 解決「GitHub 在哪個方向、交給誰轉」（外部路由的散佈）。

打個比方：IGP 像公司大樓的內部平面圖，管你從這間辦公室走到那間該怎麼繞，純粹是樓裡怎麼移動。iBGP 不一樣，它管的是「要出公司去外面，該走哪個門出去比較快」：邊界的同事先從外面打聽到「要找 GitHub，走北門那個出口最快」，再靠 iBGP 把這件事傳給樓裡其他人，不然大家不知道該往哪個門送。

## 選路規則

BGP 收到多條路徑時，依序比較：

```text
1. Local Preference     → 管理員手動設的偏好，越高越好
2. AS Path Length       → 經過的 AS 越少越好
3. Origin               → IGP > EGP > Incomplete
4. MED (Multi-Exit Discriminator) → 對方 AS 建議從哪個出口進來
5. eBGP > iBGP          → 外部學到的優先
6. IGP cost to next hop → 內部到下一跳的成本
```

實務上大部分決策在前兩步就結束了。管理員用 local preference 控制流量走哪條線路（比如付費較低的 transit），AS path 才處理剩下的。

### MED 怎麼用

MED（Multi-Exit Discriminator，多出口區分值）是一個 AS 對鄰居說：「你要進來的話，從這個門口會比較方便。」就像你家有前後兩個門，你會跟常來的鄰居說「走後門那條巷子比較不會塞車」。

```text
AS1299 (Telia)          AS36459 (GitHub)
  R3 ──────────────────── R5  (MED 100)
  R4 ──────────────────── R6  (MED 50)    ← MED 低，優先
```

GitHub 對兩個出口設不同 MED。Telia 看到兩條路 AS path 一樣長，就用 MED 決定 → 選 R4→R6。MED 越低越優先。

限制：MED 只是建議，對方可以忽略。而且只在同一個鄰居 AS 的多條路徑之間比較，跨 AS 不比。

## BGP Hijack

BGP 建立在信任之上。任何 AS 都能宣告任何網段，沒有內建驗證。而選路時最長前綴會贏：真路由一直都在也沒用，只要有人宣告一條更細的假路由（在別人的 `/22` 裡塞一條 `/24`），全世界的 router 就改走假的那條。2008 年巴基斯坦電信就是這樣不小心讓 YouTube 全球斷線約 2 小時。

防禦：RPKI（Resource Public Key Infrastructure）用數位簽章驗證「這個 AS 有沒有權利宣告這個網段」。但採用率還在爬升中，不是所有 AS 都檢查。
