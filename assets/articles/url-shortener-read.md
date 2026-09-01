---
title: "短網址點下去馬上跳走，那一下點擊是怎麼被記到的"
slug: url-shortener-read
subtitle: "redirect 要快、analytics 又要確保數據都完整，這兩件事很難同時做好。"
chapter: "url-shortener"
tags: [url-shortener, rate-limiter, cdn, analytics, idempotency, fan-out]
date: 2026-03-21
related: [url-shortener-key, url-shortener-store, url-shortener-demo]
---

# 短網址點下去馬上跳走，那一下點擊是怎麼被記到的

前兩篇解決了「怎麼生 key」和「怎麼存」。但還沒回答：用戶點了短網址，然後呢？

```text
第一篇：long_url → short_key（怎麼生）
第二篇：short_key → DB/cache（怎麼存）
第三篇：用戶點了短網址 → 流量進來時怎麼走
```

前兩篇是靜態的（資料怎麼放），這篇是動態的（流量打進來時的 read path、write path、analytics pipeline、hot URL）。面試官在這篇會問最多 follow-up，因為流量壓力都在這一段。

短網址的功能就是 redirect。有人貼了一個短連結到社群平台，十萬人同時點。每一次點擊都是一個 HTTP request，server 要在幾十毫秒內回傳 302。同時，產品經理要看 dashboard：這個連結今天被點了幾次？從哪些國家來？尖峰在什麼時段？

記點擊是額外的事，做了會拖慢 redirect，可是 redirect 又快不得。

---

## Read Path

一個 redirect request 從發出到完成：

```text
用戶點擊 short.url/Xk9mP2q
  → DNS 解析
  → Load Balancer
  → Application Server
    → 查 Redis cache
      ├─ 命中 → 回傳 302 + long_url
      └─ 沒命中 → 查 DB → 寫入 cache → 回傳 302
```

整個 path 最慢的環節是 cache miss 時的 DB 查詢。前一篇已經處理了 cache 和 sharding。正常情況下 cache hit rate > 90%，大部分 redirect 在幾毫秒完成。

### 如果 URL 不存在

short_key 查不到，回 404。但在回 404 之前，要先查完 cache 和 DB，確認真的不存在。

如果有人惡意打大量不存在的 short_key，每個都 cache miss，每個都查 DB。這叫 cache penetration。

防禦：用 Bloom filter。把所有存在的 short_key 放進 Bloom filter。request 進來先查 Bloom filter。「一定不存在」直接回 404，不查 cache 也不查 DB。

```text
short_key = "fakeKey"
  → Bloom filter: 一定不存在 → 404（省掉 cache + DB 查詢）

short_key = "Xk9mP2q"
  → Bloom filter: 可能存在 → 繼續查 cache → ...
```

---

## Write Path

建立短網址的 API：

```text
POST /api/shorten
{
  "long_url": "https://example.com/very/long/path",
  "custom_alias": "my-brand",    // optional
  "expires_in": "30d"            // optional
}
```

### Rate Limiting

寫入 API 需要保護。不是所有人都能無限建立短網址。

```text
Rate limiter:
  匿名用戶：10 次/小時
  登入用戶：1000 次/小時
  付費用戶：10000 次/小時
```

Rate limiter 放在哪一層？

```text
方案 A：API Gateway 層（最早攔截，省 application server 資源）
方案 B：Application 層（可以根據 user tier 做不同限制）
方案 C：兩層都放（Gateway 擋 DDoS，Application 擋 per-user abuse）
```

### Idempotency

同一個 request 送了兩次（網路重試），不應該建立兩個不同的短網址。

```text
第一次：POST /api/shorten + Idempotency-Key: abc-123
  → 建立 short_key = "Xk9mP2q"，儲存 {abc-123: "Xk9mP2q"}
  → 回傳 201

第二次：POST /api/shorten + Idempotency-Key: abc-123
  → 查到 abc-123 已處理
  → 回傳 201 + short_key = "Xk9mP2q"（不建立新的）
```

Idempotency key 存 Redis，TTL 24 小時。超過 24 小時不太可能是 retry，而是新的 request。

---

## Analytics

產品經理的需求：

1. 每個短網址的總點擊數
2. 每日/每小時的點擊趨勢
3. 點擊來源的國家、裝置、瀏覽器
4. Real-time dashboard

### 問題：redirect path 不能變慢

如果每次 redirect 都同步寫一筆 click record 到 DB，redirect 的延遲從 5ms 變成 50ms。十萬 QPS 下 DB 也撐不住。

### 解法：異步

Redirect 時不寫 DB。把 click event 丟進 message queue，立刻回 302。

```text
用戶點擊 short.url/Xk9mP2q
  → 查 cache → 拿到 long_url
  → 發 click event 到 Kafka
     {short_key, timestamp, ip, user_agent, referer}
  → 回傳 302 + long_url

Kafka consumer（另一組 worker）：
  → 消費 click event
  → 解析 IP → 國家
  → 解析 User-Agent → 裝置、瀏覽器
  → 寫入 analytics DB（ClickHouse / TimescaleDB）
```

Redirect path 完全不碰 analytics DB。click event 丟進 Kafka 是毫秒級操作（append-only log）。

### 301 vs 302 再看一次

```text
301：瀏覽器快取 redirect，後續點擊不經過 server
302：每次都經過 server
```

用 301，click event 只會記錄第一次。後續的都被瀏覽器攔截，server 不知道。Analytics 嚴重低估。

用 302，每次都經過 server，每次都能記錄。Analytics 完整。

如果不需要 analytics，301 省大量 server 負擔。需要 analytics 就必須用 302。大部分短網址服務選 302。

### Click Count 的快速查詢

Analytics consumer 把 click event 聚合後寫入 analytics DB。但產品經理想要 real-time 的點擊數。

用 Redis 的 INCR：

```text
每次 redirect 時：
  INCR click_count:Xk9mP2q
  （原子操作，O(1)，不碰 analytics DB）

Dashboard 查詢：
  GET click_count:Xk9mP2q
  → 12,847
```

Redis INCR 是原子的，高併發下不會丟數。但 Redis 重啟會丟。定期把 Redis 的 count 同步到 analytics DB 做持久化。

---

## Hot URL

一個短網址突然爆紅。十萬人在同一秒點。

### Cache 層的問題

如果這個 URL 剛好 cache miss（TTL 到期或 Redis 重啟），十萬個 request 同時打 DB。

防禦：**Singleflight / request coalescing**。十萬個 request 中，只有第一個去查 DB。其餘的等第一個的結果。

```text
request 1 → cache miss → 去查 DB → 拿到結果 → 寫入 cache → 回傳
request 2~100000 → cache miss → 發現有人正在查 → 等待 → 拿到 request 1 的結果 → 回傳
```

### CDN 層

如果某個短網址的流量大到單台 application server 撐不住，可以用 CDN。

```text
用戶 → CDN edge（全球各地）→ origin server
```

CDN 快取 302 response？一般不行，302 是臨時 redirect。但可以用 `Cache-Control: public, max-age=300` 讓 CDN 快取 5 分鐘。5 分鐘內同一個短網址的 redirect 全由 CDN 回應，不打 origin。

代價：這 5 分鐘內的 click event 不會被記錄（因為沒經過 origin server）。Analytics 的精確度和 CDN 快取時間成反比。

---

## Fan-out：通知連結擁有者

進階功能：連結擁有者想即時收到通知「有人點了這個連結」。

```text
少量 follower（個人用戶，幾個連結）：
  → Fan-out on write：每次點擊推送通知

大量 follower（企業用戶，幾千個連結）：
  → Fan-out on read：Dashboard 打開時才拉最新數據
```

個人用戶的連結點擊量不大，推送通知可以接受。企業用戶的連結可能每秒上千次點擊，推送通知會爆掉 notification service。

---

## 面試官追問

---

> **「Kafka consumer 掛了，click event 堆積在 Kafka 裡。redirect 會受影響嗎？」**
>
> 不會。App server 把 click event 丟進 Kafka 後立刻回 302，不等 Kafka 確認。Consumer 有沒有在讀，redirect server 完全不知道也不在意。兩條 path 解耦，互不影響。
>
> Kafka 預設保留 7 天，堆超過就開始掉資料：
>
> ```text
> Consumer 掛了 6 小時：
>   → 6 小時的 click event 堆在 partition 裡
>   → 恢復後從 offset 繼續讀，全部補上
>   → Dashboard 補齊，資料零損失
>
> Consumer 掛了 8 天：
>   → 7 天前的 event 被 Kafka 刪掉（retention 到期）
>   → 那段資料永久丟失，analytics 有空缺
> ```
>
> 監控：追蹤 consumer group lag（目前 offset 距離最新 offset 多遠）。Lag 突然暴增代表 consumer 跟不上或已掛，要在 retention 到期前觸發告警。

---

> **「Redis INCR 的 click count 和 analytics DB 的 count 不一致。哪個才是 source of truth？」**
>
> 兩個都不是獨立的 source of truth。Redis 存的是上次 flush 後的增量，不是全量；ClickHouse 存的是歷史累積，不含最新的增量。真正的 total 要兩個加起來：
>
> ```text
> ClickHouse total_clicks：12,000（歷史累積）
> Redis INCR：847（上次 flush 後新增）
>
> 真正的 total = 12,000 + 847 = 12,847
>
> flush 發生後：
>   ClickHouse total_clicks → 12,847
>   Redis INCR → 0（歸零，重新累積）
> ```
>
> Kafka 才是 source of truth，所有 click event 都從這裡流過，兩個 storage 都是從 Kafka 派生出來的視圖。如果兩個數字加起來跟 Kafka 的 event 數對不上，以 Kafka replay 為準。
>
> 實務上不會有人真的去 replay Kafka 對帳。Click count 是 best-effort，輕微誤差可以接受。面試時說清楚這個 tradeoff 就夠。

---

> **「同一個人重複點同一個短網址，click count 要不要 dedup？」**
>
> Total clicks 和 unique visitors 是兩個不同的指標，分開計算。
>
> 識別「同一個人」靠 IP 或 session ID（cookie）。兩個都不精確：IP 在辦公室環境幾百人共用，session 在無痕模式下每次都是新的。但 unique visitor 本來就不需要精確到個位數，夠用。
>
> 兩個工具，目的不同：
>
> **Bloom filter** — 回答「這個 session 有沒有點過」（yes/no），用來擋重複：
>
> ```text
> 點擊進來
>   → Bloom filter 查 session_abc 有沒有出現過
>     ├─ 沒出現 → INCR click_count，把 session_abc 加進 filter
>     └─ 出現過 → 不 INCR，這次不算
> ```
>
> **HyperLogLog** — 回答「總共有幾個 unique session」（數字），用來計數：
>
> ```text
> PFADD unique:Xk9mP2q "session_abc"   → 加入
> PFADD unique:Xk9mP2q "session_abc"   → 已存在，沒變
> PFCOUNT unique:Xk9mP2q              → 約 9,200（誤差 0.81%）
> ```
>
> HyperLogLog 不存每個 session ID，只更新內部固定大小的計數器（12KB）。一百萬個 unique visitor 還是 12KB，不會因為 cardinality 增長而膨脹。用一般的 Redis Set 存 session ID，一百萬個就是幾十 MB，乘上所有 URL 就爆了。
>
> Bloom filter 是用來「擋重複」，HyperLogLog 是用來「估算總數」。兩個目的不同，搭配使用。

---

> **「analytics data 越來越大（每天幾億筆 click event）。怎麼控制成本？」**
>
> 把 7 天前的 raw event squash 成 daily summary，raw event 刪掉。Summary 保留永久，空間可以預測。
>
> Daily summary schema：
>
> ```text
> short_key | date       | country | device  | total_clicks
> Xk9mP2q  | 2026-03-28 | TW      | mobile  | 1,234
> Xk9mP2q  | 2026-03-28 | TW      | desktop | 567
> Xk9mP2q  | 2026-03-28 | US      | mobile  | 890
> ```
>
> 每個 (short_key, date, country, device) 組合一筆。Date 本身就是 time range，不需要額外存 timestamp range。
>
> 保留 7 天而不是 1 天，原因是對齊 Kafka retention。這 7 天內如果發現 consumer 有 bug（寫錯資料），可以從 Kafka replay 重新處理。超過 7 天 Kafka 也刪了，raw event 就沒有補救機會，squash 掉沒有損失。
>
> Dashboard 查詢：7 天內走 raw events（任意維度），更早的走 daily summary。用戶看不到接縫。

---

> **「如果不用 302 而用 301（讓瀏覽器快取），但又想要 analytics，有沒有辦法兩全？」**
>
> 從 URL shortener 自己的角度：沒有辦法。
>
> 301 瀏覽器快取後，後續的點擊直接跳到 destination，完全不經過 server。Server 看不到流量，analytics 斷掉。
>
> 有人會想到：在 landing page 注入 tracking script，用戶跳過來後 JS 打 analytics beacon 回來。但 landing page 是別人的網站，URL shortener 控制不了，注入不進去。
>
> 另一條路是中間頁：301 先跳到自己控制的中間頁，記錄完再 redirect 到 long_url。可以記錄，但用戶看得到閃爍，體驗差，沒有服務這樣做。
>
> 需要 analytics 就只能用 302。這裡能把「301 為什麼行不通」講清楚就夠了，不必硬擠一個兩全的 workaround。
>
> ---
>
> 使用者（在 destination page 放 GA 的行銷人員）不受影響，GA 在 landing page 載入後才觸發，不管來的是 301 還是 302 都能記錄。這是兩個不同的 analytics 需求，不要混在一起。

---

> **「整個 analytics pipeline 掛了（Kafka + consumer 全掛）。redirect 應該繼續服務還是降級？」**
>
> Redirect 繼續。Analytics 是附加功能，redirect 是核心產品。Analytics 掛了，用戶點連結還是要能跳到目的地。Redirect 掛了就嚴重了，用戶點連結根本跳不過去，這時 analytics 有沒有壞根本顧不到。
>
> 設計上不能讓 analytics 拖垮 redirect。Fire-and-forget：app server 把 click event 丟進 Kafka，不等 ack，直接回 302。Kafka 掛了頂多丟幾筆 click event，redirect 完全不受影響。
>
> 這是 graceful degradation 的基本原則：非核心功能的故障不能傳播到核心 path。

---

## 沒有 X 怎麼辦

---

> **「不能用 Kafka。click analytics 怎麼做？」**
>
> 用 Redis List 當 queue。每次 redirect 把 click event `LPUSH` 進去，一個 worker 定期批次取出寫入 analytics DB：
>
> ```text
> redirect → LPUSH click_queue {event}
>
> worker 每 30 秒：
>   LRANGE click_queue 0 999   → 取 1000 筆
>   bulk insert → analytics DB
>   LTRIM click_queue 1000 -1  → 刪掉已處理的
> ```
>
> 跟 Kafka 的差別：Kafka consumer 掛了，offset 不動，恢復後從上次繼續。Redis LTRIM 刪了就沒了，worker 掛在 bulk insert 之前那批 event 丟失。Click count 是 best-effort，這個風險通常可以接受。

---

> **「不能用 CDN。hot URL 怎麼扛？」**
>
> Redis cache 本來就在了，但 hot URL 的問題是 Redis 的 hot key——同一個 key 幾萬個 request 同時打，單一 shard 扛不住。
>
> 在 Redis 之上加一層 app server 的 in-process local cache：
>
> ```text
> redirect 進來
>   → 查 local cache（in-memory，奈秒）
>     ├─ 命中 → 回 302（Redis 都不用碰）
>     └─ 未命中 → 查 Redis → 寫入 local cache → 回 302
> ```
>
> Short_key → long_url 建立後不會改，local cache 的值永遠正確，不需要 invalidation。Hot URL 在每台 server 各自有 copy，Redis 的 hot key 問題消失。

---

> **「不能用 Redis INCR。real-time click count 怎麼做？」**
>
> 每台 app server 在 process 記憶體裡用 atomic counter，定期 flush 到 DB：
>
> ```text
> 每次 redirect：
>   counter["Xk9mP2q"] += 1（atomic，thread-safe）
>
> 每 30 秒：
>   UPDATE url_stats SET total_clicks = total_clicks + {delta}
>   counter["Xk9mP2q"] = 0
> ```
>
> 多台 server 各自 flush，DB 用 `+= delta` 累積，最終加起來就是總數，不需要 server 之間協調。Server 重啟最多丟 30 秒的數字，click count 是 best-effort，可以接受。

---

## 整個系統

三篇走完。把整個系統畫在一起：

```text
                                    ┌─────────────┐
                                    │   CDN Edge   │
                                    └──────┬───────┘
                                           │
┌────────────┐    POST /shorten     ┌──────┴───────┐    GET /<key>
│   Client   │ ──────────────────→  │     LB       │ ←──────────────
└────────────┘                      └──────┬───────┘
                                           │
                              ┌────────────┴────────────┐
                              │    Application Server    │
                              │  ┌─────────┐ ┌────────┐ │
                              │  │ Rate    │ │ Bloom  │ │
                              │  │ Limiter │ │ Filter │ │
                              │  └─────────┘ └────────┘ │
                              └────┬─────────────┬──────┘
                                   │             │
                            ┌──────┴──┐    ┌─────┴──────┐
                            │  Redis  │    │   Kafka    │
                            │  Cache  │    │ click event│
                            └────┬────┘    └─────┬──────┘
                                 │               │
                            ┌────┴────┐    ┌─────┴──────┐
                            │ DB Shard│    │ Analytics  │
                            │ 0,1,2,3 │    │ Consumer   │
                            └─────────┘    └─────┬──────┘
                                                 │
                                           ┌─────┴──────┐
                                           │ ClickHouse │
                                           │ Analytics  │
                                           └────────────┘
```

| 元件 | 對應的 chunk |
|---|---|
| Short key 生成 | unique-id, bloom-filter |
| Cache | cache-strategies, cache-eviction |
| DB sharding | sharding, consistent-hashing |
| Rate limiting | rate-limiter |
| Idempotency | idempotency |
| Analytics pipeline | fan-out |
| CDN | cdn-caching |
| Real-time push | websocket |

每個元件都對應一個已經讀過的 chunk。面試時不需要背整個架構圖，從 chunk 組合出來就好。面試官追問任何一個元件，都能往下鑽一層。
