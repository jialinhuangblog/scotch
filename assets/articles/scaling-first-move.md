---
title: "高併發一進來，先經過 CDN、cache、queue 這幾層，真正走得到 DB 的就剩一些些了"
slug: scaling-first-move
subtitle: "零件都認得，不知道的是該先動哪一塊、為什麼。"
chapter: "scaling"
tags: [cache-strategies, cqrs, cap, sharding, reverse-proxy, api-gateway, cdn]
date: 2026-04-07
related: [cache-hot-key, queue-peak-shaving, rate-limiter, storage-deep, replication-cap]
---

# 高併發一進來，先經過 CDN、cache、queue 這幾層，真正走得到 DB 的就剩一些些了

系統要處理每秒一百萬個 request。

CDN、Load Balancer、Cache、Sharding、CQRS、Message Queue，這些零件都認得，也講得出來。但畫不出一個 request 從進來到 DB 回傳走的那條路，也說不出先加什麼、後加什麼。

---

## 一個 request 走的路

一個 request 從用戶瀏覽器出發，到 DB 再回來：

```text
用戶 → CDN → Load Balancer → API Gateway → App Server → Cache → DB
```

這條線同時也是決策順序。

流量從左邊進來，所以從左邊開始處理。左邊那一層不夠用了才往右加下一層，不是一開始就全部擺上去。

[CDN](chunk://cdn-caching) 直接回應靜態資源的請求。命中率如果有 80%，100 萬個 request 裡有 80 萬根本不會到 server。

[Load Balancer](chunk://l4-vs-l7-lb) 把剩下的 20 萬分給多台 App Server。L4 快，只看 IP + port。L7 慢一點，但能看 URL path 和 header，能做更精準的路由。大部分場景用 L7。

[API Gateway](chunk://api-gateway) 做驗證、rate limit、request transform。LB 只分配流量，Gateway 會看內容做驗證跟限流。

到了 App Server 之後，才開始跑應用程式碼。

---

## Read path 和 Write path 分開看

大部分系統讀遠多於寫。Read path 跟 write path 的瓶頸不同，解法也不同。

### Read Path 的決策鏈

Read path 的目標是盡量不要碰 DB。

**第一步：加 cache。** 最直覺的選擇是 [Cache-Aside](chunk://cache-strategies)。Application 自己管 cache。先查 Redis，miss 再查 DB，查到後寫回 Redis。做法簡單、行為可控，大部分系統用這個就夠。

**第二步：cache 失效，請求直接進到 DB。** 加大容量解決不了，問題出在 cache 失效的方式。

| 情境 | 原因 | 解法 |
|---|---|---|
| 雪崩 | 大量 key 同時過期 | TTL 加隨機值 |
| 穿透 | key 根本不存在 | [Bloom filter](chunk://bloom-filter) |
| 擊穿 | 熱點 key 過期 | Mutex + singleflight |

三種都是請求沒被 cache 回應而全部進到 DB。詳見 [cache 平常都夠用，直到所有人同一秒都去要同一個 key](article://cache-hot-key)。

**第三步：DB 本身處理不了。** 加 read replica。一台 master 寫，多台 follower 讀。讀的流量線性分散。代價：replication lag，follower 可能落後幾毫秒。見 [資料複製了，然後一致性呢](article://replication-cap)。

**第四步：read replica 也不夠了。** [Sharding](chunk://sharding)。資料切成多份，每份放不同機器。讀寫都分散。代價：跨 shard 查詢很難處理，要 resharding 又更麻煩。見 [查詢從 2ms 變成 1.2 秒只因為資料變多，後面 index、partition、sharding 都是為了讓每次查詢更容易找到資料](article://storage-deep)。

### Write Path 的決策鏈

Read path 有一個明確的預設答案：Cache-Aside。Write path 沒有。

三個選項，犧牲的分別是延遲、耐久性、首次讀取命中：

**[Write-Through](chunk://cache-strategies)**：寫 cache 和 DB，兩邊都成功才回傳。

```text
用戶寫入 → 更新 cache → 更新 DB → 都成功 → OK
```

一致性最高。但每次寫入都是兩次操作，延遲也最高。

**[Write-Behind](chunk://cache-strategies)**：只寫 cache，背景非同步批次寫 DB。

```text
用戶寫入 → 更新 cache → 立刻 OK
（背景）累積一批 → batch 寫入 DB
```

延遲最低。但 cache 掛了，還沒寫入 DB 的資料就丟了。

**Write-Around**：只寫 DB，不動 cache。下次讀取 miss 時再載入。

```text
用戶寫入 → 更新 DB → OK
（下次讀）cache miss → 從 DB 載入 → 寫回 cache
```

最簡單。但剛寫的資料第一次讀一定是 cache miss。

#### 怎麼選

**問題一：資料丟了會出事嗎？**

會（用戶餘額、訂單）→ Write-Through。同步寫入，兩邊一致。慢，但安全。

不會（按讚數、瀏覽次數）→ Write-Behind。快，偶爾丟幾筆沒人發現。

**問題二：寫完馬上會被讀嗎？**

會（改完名字馬上看到）→ Write-Through 或 Write-Behind。cache 都是最新的。

不會（log、analytics、歸檔）→ Write-Around。寫進 cache 也浪費空間。

```text
                   資料丟了會出事？
                    /           \
                  是              否
                  |               |
            Write-Through    Write-Behind
                  |
            寫完馬上被讀？
            /         \
          否            是
          |             |
    Write-Around   (維持 Write-Through)
```

---

## 什麼時候拆 CQRS

Read path 和 write path 分開想，是思考方式。[CQRS](chunk://cqrs) 是把這個思考方式變成架構：read model 和 write model 用不同的 schema，甚至不同的 DB。

大部分系統不需要 CQRS。三個引入訊號：

**訊號一：read model 和 write model 長得完全不一樣。** 寫入存正規化的 orders + order_items + products。Dashboard 要的是「本月各類商品銷售排名」。每次讀都 JOIN 三張表再 GROUP BY。如果把排名預先算好存成另一張表，讀取就是一次 SELECT。

**訊號二：read 和 write 的 scale 差異極大。** Write 每秒 100 筆，read 每秒 10 萬。共用同一張表，write 的 lock 拖慢 read。分開後各自 scale。

**訊號三：已有 event-driven 架構。** Write 端 publish event，read 端 consume event 更新自己的 model。有 [message queue](chunk://message-queue-comparison) 了，CQRS 只是多一個 consumer 去更新 read model。

### 什麼時候會後悔

CQRS 的代價是雙倍的 schema 維護。每次改 write model 都要想 read model 跟不跟。要是 read/write model 其實差不多，CQRS 只是在製造同步問題。

read model 是非同步更新的，這也是代價。用戶寫入後，read model 可能還沒更新。這段時間用戶看到的是舊資料。如果這不能接受，CQRS 可能不適合。

---

## CAP：從三角形到實際選擇

[CAP](chunk://cap) 常被畫成一個三角形：Consistency、Availability、Partition Tolerance，三選二。但 partition 一定會發生，實際能選的只有網路斷線時要 C 還是 A。

所以「你的系統是 CP 還是 AP」這個問法本身就不對。CP 或 AP 該選的是每筆資料、每個操作，而不是整個系統一次定下來。

| 資料 | 選擇 | 為什麼 |
|---|---|---|
| 用戶餘額 | CP | 寧可暫時不可用，也不能扣錯錢 |
| 按讚數 | AP | 暫時顯示 999 還是 1001 沒人在意 |
| 庫存扣減 | CP | 超賣是實際損失 |
| 庫存顯示 | AP | 顯示「剩 3 件」其實剩 5 件，問題不大 |
| Session | AP | 偶爾重新登入，比完全不能登入好 |

同一個系統裡，不同資料用不同策略。甚至同一筆資料的讀和寫用不同策略，例如庫存扣減選 CP，庫存顯示選 AP。

### CAP 和 cache 策略怎麼接

回頭看前面的 write path 選擇：

- Cache-Aside + read replica = AP 傾向。cache 和 replica 都可能是 stale data，但可用性高。
- Write-Through + 同步 replication = CP 傾向。每次寫入都等兩邊確認，一致但慢。

選 cache 策略的時候，其實已經在做 CAP 的選擇了，只是沒有用 CAP 的詞彙在想。

---

## 雲端做掉了哪些

在 AWS 上有些層已經做掉了，剩下的還是要自己決定：

| 概念 | AWS 做掉的 | 還是要自己決定的 |
|---|---|---|
| [CDN](chunk://cdn-caching) | CloudFront：全球邊緣節點、GZIP、HTTP/2 | Cache Behavior、TTL、invalidation 規則 |
| [Load Balancer](chunk://l4-vs-l7-lb) | ALB / NLB：健康檢查、auto-scaling 整合 | Target group、routing rule |
| [Cache](chunk://cache-strategies) | ElastiCache Redis：自動備份、故障轉移 | cache 策略選擇、key 設計、TTL |
| [DB](chunk://aurora) | Aurora：自動備份、故障轉移、read replica、storage 自動擴展 | Connection pool 設定、index、query 優化 |
| [Sharding](chunk://sharding) | DynamoDB：自動分區、容量自動調整 | Partition key 設計（選錯 = hot partition） |

---

## 精力怎麼分配

```text
90%  Application Layer
      ├── cache 策略選擇（Cache-Aside? Write-Behind?）
      ├── read/write path 設計
      ├── CQRS 要不要拆
      ├── key 設計（Redis key、partition key）
      └── query 優化（index、N+1）

 9%  Configuration
      ├── connection pool size
      ├── TTL 設定
      ├── replica 數量
      └── rate limit 閾值

 1%  Infrastructure
      └── managed service 處理掉了
```

---

## 組裝順序

回到最開始的問題。一百萬個 request 進來，要先動哪一塊呢？

```text
1. 畫線    CDN → LB → Gateway → App → Cache → DB
2. 切      read path 和 write path 分開
3. Read    Cache-Aside 起手，miss 太多再對症
4. Write   問兩個問題：丟不丟得起？寫完馬上讀嗎？
5. 還不夠  replica → sharding → CQRS（大部分系統到不了這步）
6. CAP     不是整個系統選，是每筆資料每個操作選
```
