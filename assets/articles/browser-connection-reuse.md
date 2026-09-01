---
title: "瀏覽器早就內建 connection pool，只是輪不到你設定"
slug: browser-connection-reuse
subtitle: "對同一個 domain 最多六條、HTTP/2 併成一條、coalescing 連別的 domain 都併進來、HTTP/3 讓連線換網路也不斷。規則全是瀏覽器訂的，頁面載入的形狀由它決定。"
chapter: "buffer"
tags: [connection-pooling, http2, http3, coalescing, san, cdn, performance]
date: 2026-07-20
related: [resource-pool-pattern, db-connections]
---

# 瀏覽器早就內建 connection pool，只是輪不到你設定

[Pool 那篇](article://resource-pool-pattern)講過這個 pattern 的條件：建立成本高、可以重複用的資源，就值得留著別丟。[DB 連線那篇](article://db-connections)講 server 端怎麼管。其實你每天用得最多的 pool 在瀏覽器裡，每開一個網頁它就在運作，只是沒有任何 API 讓你設定它。這篇講它的規則怎麼演化：從六條、到一條、到連別人的 domain 都併進來。

## 貴在哪：一條連線的成本

開一條 HTTPS 連線，[TCP](chunk://tcp) 握手一趟 RTT，[TLS](chunk://tls) 再一到兩趟。行動網路 RTT 常常是 50~100ms，等於一條連線還沒送半個 byte，先付掉一兩百毫秒。頁面有 50 個資源，如果每個都重新連線，成本直接乘上去。

這就是 pool pattern 的教科書場景：連線貴、可重用，所以瀏覽器從 HTTP/1.1 的 keep-alive 開始就內建了 pool。問題在 pool 的形狀。

## HTTP/1.1：pool size 寫死 6

HTTP/1.1 的一條連線同時只能跑一個 request，回應回來才能送下一個。50 個資源在一條連線上就是排隊。瀏覽器的折衷：對同一個 origin 開 6 條連線，六個窗口同時服務，第七個資源還是得等。

6 這個數字是瀏覽器寫死的，網站不能調。當年的繞法是 domain sharding：把資源分散到 `static1.example.com`、`static2.example.com`，騙瀏覽器「這是不同 origin」，多開幾組六條。代價是每個 shard 都要重付 DNS 查詢加握手。

## HTTP/2：pool size = 1

[HTTP/2](chunk://http2) 把每個 request 切成 frame、標上 stream id，一條連線上交錯傳輸。50 個資源 = 50 個 stream，全部塞同一條 TCP，握手只付一次。pool 從「6 條各跑一個」變成「1 條全包」。

於是 domain sharding 從優化變成反模式：多一個 shard 就是多付一組 DNS 加握手，換來的平行度 HTTP/2 在單一連線裡就有了。

## Coalescing：連別的 domain 都併進來

HTTP/2 的瀏覽器還會更進一步。不同 hostname 如果**證書 SAN（Subject Alternative Name）涵蓋且 DNS 解到同一 IP**，瀏覽器會把它們合併到同一條 TCP。新 hostname 的 request 直接在現有 connection 上開 stream，`:authority` pseudo-header 標明目的：

> **SAN 是什麼？** TLS cert 上的一個欄位，列「這張憑證合法服務哪些 hostname」。CA 發 cert 前要對 SAN 裡每個 hostname 做 **DCV（Domain Control Validation）**：HTTP / DNS / TLS challenge 擇一，證明你控制這個 domain 才會發。所以你不能把不是你的 domain 偷塞進 SAN。CDN 能在一張 cert 塞幾百個客戶 domain，是因為**客戶把 DNS NS 指到 CDN**，等於授權 CDN 代為驗證。延伸：每張 cert 必須登錄 [Certificate Transparency log](https://crt.sh)，瀏覽器拒絕沒進 CT 的 cert，所以亂發抓得到。Chrome 從 2017 起完全忽略 cert 的 CN 欄位，**只看 SAN**。

```text
已開：browser ↔ 1.2.3.4 (cert SAN: example.com, *.example.com, cdn.othersite.com)

抓 https://images.example.com/x → 同 IP + SAN 涵蓋 → 重用
抓 https://cdn.othersite.com/y  → 同 IP + SAN 顯式列了 → 重用
```

CDN 把這個優化吃到極致。Cloudflare Universal SSL 一張 cert 把**幾百個客戶 domain 塞進同一份 SAN**，客戶 A 的 `a.com` 跟客戶 B 的 `b.com` 解到同一台 edge IP，browser 在同一頁載入時把所有 request 走**同一條 connection**。少幾百毫秒的 TCP + TLS 握手是 H2 在 multi-tenant CDN 的隱形紅利。

副作用是 domain sharding 被自動抵銷。把資源分散到 `static1`、`static2` 想多開連線，如果它們解到同一 IP + 同一 cert，瀏覽器 coalesce 回一條，sharding 的努力白費。要保住 sharding 得讓 subdomain 解到不同 IP 或發不同 cert，但在 H2 之後也沒理由保它了。

延伸：[ORIGIN frame（RFC 8336）](https://datatracker.ietf.org/doc/html/rfc8336) 讓 server 主動告訴 client「這條 connection 我也能服務 a.com、b.com」，不用每個 hostname 都重做一次 DNS + cert 檢查，coalesce 更積極。Cloudflare 有發、瀏覽器支援度普通。

## HTTP/3：pool 裡的連線換網路也不失效

TCP 連線綁定 (src_ip, src_port, dst_ip, dst_port)，手機從 Wi-Fi 切 4G，IP 一變連線就作廢，pool 整個重建。[HTTP/3](chunk://http3-quic) 的 QUIC 用 connection ID 認連線，IP 換了照常用。對 pool 來說，這是把「資源失效」的最大來源拿掉了。

0-RTT 重連也是同一種 pool 思路：對造訪過的 server，把上次的 session 資訊留著，重連時握手跟第一個 request 一起送。相當於 pool 清空之後，重建的成本也接近零。

## 跟 DB pool 對照

| | DB connection pool | 瀏覽器 connection pool |
|---|---|---|
| pool 大小誰決定 | 你設（max size、PgBouncer mode） | 瀏覽器寫死（6 條/origin、H2 一條） |
| 一條連線同時服務幾個 | transaction mode 下多個 client 輪流 | H2 幾十個 stream 交錯 |
| 失效處理 | health check、stale 踢掉 | H3 connection ID 讓換網路不失效 |
| 你能做的 | 調參數 | 配合規則（減少 domain、preconnect） |

PgBouncer 的 transaction mode 跟 HTTP/2 multiplexing 是同構的：把很多邏輯上的使用者塞進少數實體連線，靠「切小單位輪流」提高利用率。差別在 DB 這邊是你自己選 mode、自己踩 session state 的坑；瀏覽器這邊整套邏輯內建，出錯的方式變成「你以為的優化其實在跟它打架」。

## 決策視角：前端效能還剩什麼要做

情境：一個老電商前端，HTTP/1.1 時代認真優化過：domain sharding、CSS sprite、inline 小圖，現在站在 CDN 後面升上了 HTTP/2。

決策路徑：第一步是把舊優化清出來重新審一遍，因為它們的前提翻掉了。sharding 的兩種下場都不好：subdomain 解到同一台 CDN edge，被 coalesce 併回一條，等於白留一堆 DNS 設定；解到不同 IP，就是每個 shard 真的多付握手，在 H2 下純虧。合併回單一 domain 是正解。sprite 和 inline 同理，H2 下 50 個小請求的成本跟一個大請求差距不大，換回獨立小檔還能各自吃 cache。第二步才是加新的：對真正無法合併的第三方（金流、分析）補 `preconnect`，讓握手提前做；CDN 上把 HTTP/3 開起來，行動端受益最大。

Regret signal：`preconnect` 撒太多，每個都真的開連線，搶頻寬又佔資源，控制在少數幾個關鍵 domain。另一個是改完沒看數據，coalescing 有沒有真的發生要看 DevTools 的 connection ID 欄位，不是看設定。

---

Pool 這個 pattern 在這條 chain 出現三次：DB 那次參數自己設，JVM 那次 reset 邏輯自己寫，瀏覽器這次整套規則是內建的。所以前端效能的工作不是設計 pool，是搞清楚瀏覽器的 pool 規則，然後別跟它作對。
