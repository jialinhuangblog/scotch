---
title: "同樣是 pool，為什麼請求結束後，有的把連線歸還、有的原封不動留著？"
slug: resource-pool-pattern
subtitle: "DB 連線池、JVM 物件池、瀏覽器 HTTP keep-alive 是同一個模式。但有的把狀態留著、有的歸還時就清乾淨。為什麼差這麼多。"
chapter: "buffer"
tags: [connection-pooling, object-pool, http2, http3, quic, performance]
date: 2026-05-04
updated: 2026-06-11
revisions: 1
related: [db-connections, latency-hierarchy, cache-hot-key, browser-connection-reuse]
---

# 同樣是 pool，為什麼請求結束後，有的把連線歸還、有的原封不動留著？

建一條 PostgreSQL 連線要 **50 毫秒**。發一個全新的 HTTP 請求要 **170 毫秒**。new 一個 Java 物件本身只要 70 奈秒，便宜到可以忽略。

但每秒 new 一百萬個，光 allocation 就累積 70 毫秒。再加上 GC 觸發 stop-the-world 暫停 5 到 50 毫秒，整個 request budget 就吃光了。

三個成本都落在毫秒級。解法也是同一個：**預先建好，反覆借還**。

但有件怪事。DB 連線池歸還時把 session 狀態清乾淨。瀏覽器則把跟 server 之間的金鑰、ticket、protocol 偏好都留著，下次連同一個 server，直接 0-RTT 開始傳。

都是 pool，歸還時一個清乾淨、一個全留著，這個差別為何而來？

---

## 共同的成本結構

每個「貴」的東西，成本都長一樣：

```
建立成本（高，一次性）
   準備工作：握手、認證、分配資源
       ↓
   能用了
       ↓
使用中（便宜）
       ↓
銷毀成本（中，丟棄）
```

如果每次用完就銷毀，下一個使用者要從頭付建立成本。這就是「不用 pool」的代價。

三種「貴的東西」攤開看：

### DB 連線

```text
DNS 解析         ~5 ms
TCP 三次握手     ~7 ms
TLS 1.3 握手     ~10 ms
PG 認證          ~10 ms
Backend fork     ~20 ms     ← PG 為這條連線 fork 一個 OS process
────────────────────────
建立總成本       ~52 ms
```

PG 特別貴在最後一步：每條連線一個 process。連 100 條就是 100 個 process，排程跟 context switch 都有成本。記憶體每條準確量大約 1 到 8 MB（看 huge_pages 設定，ps/top 常把共用記憶體算進去而高估）。詳細的 PG process 模型見 [連線不是免費的](db-connections)。

### JVM 物件

```text
new Order():
   分配 heap 記憶體     ~20 ns
   呼叫 constructor    ~50 ns
   ──────────────────────
   單次成本             ~70 ns

每秒 new 100 萬個（高頻交易場景）:
   GC 壓力累積
   Young generation 滿
   觸發 minor GC（stop-the-world）
   暫停 5 ~ 50 ms
   → 200 筆訂單機會漏掉
```

單一個物件超便宜。**新物件累積成 GC 壓力**才是真正的成本。

短命物件的累積，物件池能擋。但長期持有的大量資料（訂單簿、tick history、報價快照），需要不一樣的招數，後面會講。

### HTTP 請求

```text
首次連線：
DNS                  ~20 ms
TCP 三次握手         ~50 ms
TLS 1.3 握手         ~50 ms
HTTP request 抵達    ~50 ms
─────────────────────────
首次總延遲           ~170 ms

第二次（連線已建好）：
HTTP request only    ~50 ms
─────────────────────────
省 70%
```

對 web 來說 RTT 是主要成本。連線重用直接省掉 DNS、TCP、TLS 三層握手。

---

## 三套實作的骨架相同

不管是哪一種，pool 的結構長得一樣：

```text
pool = [resource_0, resource_1, ..., resource_N-1]
              ↑
              預先建好，閒置時待命

borrow():
   找一個 idle 的 resource
   標記為「使用中」
   回傳給 client

return(resource):
   做必要的 reset
   標記為「閒置」
   放回 pool

健康檢查:
   定期驗證 resource 是否還有效
   失效就丟棄，重建一個
```

填上不同實體：

| | DB 連線池 | JVM 物件池 | Browser 連線池 |
|---|---|---|---|
| Resource | TCP + TLS + auth + backend process | Order / Quote / Buffer 物件 | TCP + TLS 連線 |
| 借出時機 | App 要打 DB | 處理新訊息 | 發 HTTP request |
| 歸還時機 | transaction 完成 | 處理完訊息 | response 結束 |
| Pool 大小 | 20 ~ 100 條 | 1024 slot 起跳 | per-origin 6 條（H1）或 1 條（H2/H3） |
| 中介層 | PgBouncer / HikariCP | LMAX Disruptor | Browser 內建 |
| 建立省的時間 | 52 ms → 1 ms | 70 ns × 百萬次 → 0 | 170 ms → 50 ms |

骨架一樣，差別只在「resource 是什麼」「多久借一次」。

---

## 關鍵分歧：歸還時 reset 還是不 reset

這是 pool 設計最微妙的地方。三種實作走三條路。

### DB 連線池：歸還時全清掉

歸還時自動跑 `DISCARD ALL`，清掉所有 session 狀態。

```text
歸還前的連線狀態：
   transaction 進行中
   SET search_path = 'tenant_a'
   PREPARE stmt_x AS SELECT ...
   temp table tmp_orders 還在
   advisory lock 還握著

歸還後（DISCARD ALL 跑完）：
   transaction       → ROLLBACK
   session 變數      → 重置
   prepared 全清
   temp table        → DROP
   lock              → release
   
保留：
   TCP socket
   TLS 加密 context
   已認證身份
   PG backend process
```

物理連線（建立貴的部分）留著，session 狀態（會污染下個使用者的部分）全清。

理由：**下個借用者是「不同的人」**。

Web 服務的同一個 pool，第一個 request 是 user_a 的（`SET search_path = tenant_a`），第二個是 user_b。如果第二個 request 拿到第一個的殘留狀態，等於跨租戶資料污染。

### JVM 物件池：reset 內容，保留結構

```text
歸還前：
   pooledOrder:
     symbol    = "AAPL"
     price     = 150.0
     timestamp = 1714780000

歸還後（reset）：
   pooledOrder:
     symbol    = ""
     price     = 0
     timestamp = 0
   
保留：
   物件本體（GC 不會回收）
   class 結構、欄位佈局
```

reset 的成本比 DB 輕。通常只是 setter 設零，不用跑 SQL。

LMAX Disruptor 的 ring buffer 更省：**完全不主動 reset**。生產者寫進 slot 時直接覆蓋舊內容，省一層清空動作。

理由：**同一個物件不應該帶舊資料給下個訊息**，但 thread safety 邊界明確（單寫者、ring buffer 順序消費），不需要清那麼乾淨。

### Browser TLS Session：盡量留著

完全反方向。瀏覽器跟 server 之間的 session ticket、Alt-Svc、QUIC 0-RTT 金鑰，全都留著。下次連同一個 server 直接用。

```text
首次連 example.com：
   完整 TLS 握手 → 協商 master secret
   Server 回 NewSessionTicket → 包含未來重連的金鑰
   Browser 存：example.com 的 ticket
   Browser 存：Alt-Svc 標頭說對方支援 HTTP/3

二次連 example.com（幾小時內）：
   Browser 帶著 ticket：「我之前是這個 session」
   Server 用內部 STK 解開 ticket → 拿到 master secret
   跳過 certificate 驗證
   跳過 key exchange
   → 1 RTT 完成握手（原本 2 RTT）

QUIC 0-RTT 更狂：
   Browser 第一個 packet 就帶加密的 HTTP request
   Server 還沒完成握手已能 decrypt
   → 0 RTT 開始處理 request
```

理由：**同一個 browser 一直是「同一個人」**。記得越多越快，沒有跨使用者污染問題。

---

## 為什麼方向相反：看「下個用的是誰」

把三種放在一起，分歧的原因一目了然：

```text
DB pool：下個用的人 = 不同 client / 不同 user
   → 任何 session 狀態都是潛在的洩漏
   → 全部清掉

JVM 物件池：下個用的訊息 = 不同 payload，但同 process
   → 內容必須清，但結構保持
   → reset 欄位

Browser TLS：下個用的人 = 同一個 browser 連同一個 server
   → 記得越多越快
   → 盡量留著
```

關鍵變數是「**使用者邊界**」：

| 場景 | 借用者邊界 | 設計取向 |
|---|---|---|
| DB pool | 跨使用者（server-side 共用） | 清 |
| JVM 物件池 | 跨訊息（同 process 內） | reset |
| Browser TLS | 同使用者（browser 私有） | 留 |

凡是**跨使用者邊界**的 pool，session 狀態必須清，否則 leak。

凡是**同使用者邊界**的重用，記越多越好，優化空間大。

JVM 物件池在中間：邊界比 DB 窄（同一個 process 內），但比 browser 寬（不同訊息共用），所以做最輕量的 reset。

---

## Pool 不是無限可靠

每個實作都要處理「資源變壞」。

### DB pool：stale connection

連線可能因為 server idle timeout、網路 blip、防火牆關掉而失效。Client 不知道，借出去送 query 才發現對方已斷。

```text
HikariCP 設定：
   connectionTestQuery: 'SELECT 1'   ← 借出前先 ping
   validationTimeout:   5000 ms
   maxLifetime:         30 min        ← 連線太老主動丟掉重建
```

`maxLifetime` 是雙保險：就算連線還能用，也定期換新，避免長期連線的隱性 bug 累積。

### JVM 物件池：reset 漏寫

物件不會「壞」，但 reset 寫錯會帶舊資料給下個訊息。實務做法：單元測試強制檢查 reset 後所有欄位都是預設值。

```text
ill-formed reset:
   pooledOrder.symbol = "";
   pooledOrder.price = 0;
   // 漏掉 pooledOrder.metadata.clear()
   → 下一筆訂單帶到上一筆的 metadata
   → 結果訂單被送到錯的交易所，一筆就賠掉幾百萬
```

### Browser TLS Session：ticket expiry 與 replay

Session ticket 有 expiry（server 決定，通常 1 ~ 24 小時）。過期就退化回完整握手。

QUIC 0-RTT 還有 replay attack 風險：攻擊者重送之前的加密 request，server 沒辦法分辨是新還是舊。所以多數 server 對 POST、DELETE 等狀態變更請求**禁止 0-RTT**，只允許 GET 等 idempotent 操作。

---

## Pool 的代價：不是免費優化

每種 pool 都有 trade-off。

### DB pool

```text
✗ ORM 不知道背後換連線
   → SET search_path 在 transaction 結束後失效
   → 多租戶 schema 路由錯誤
✗ Long transaction 卡 pool
   → 整個 pool size 等同被砍
✗ Pool size 調不對
   → 太大，server 端 process 太多
   → 太小，app 等不到連線
```

### JVM 物件池

```text
✗ Thread safety 易踩 race condition
   → 共用物件需要單一 writer 或 lock
✗ Reset 漏寫帶舊資料
   → 比 GC bug 還難 debug
✗ 過早優化，可讀性下降
   → 一般業務 code 不該為了 GC 寫物件池
```

### Browser TLS

```text
✗ 0-RTT 對 POST 不安全
   → 自動降級或拒絕
✗ Session ticket 加密金鑰外洩 = 過去 session 全可解密
   → forward secrecy 議題
✗ CDN 跨節點不共用 ticket
   → 邊緣節點命中率不一致
```

---

## 什麼時候不要用 pool

不是所有資源都該 pool。下面情境通常該每次重建：

```text
建立成本 < 1 ms
   → 重建可忽略，pool 反而增加複雜度

資源 stateful 且難 reset
   → 清狀態的成本接近重建，沒省到

並發極低（每秒 < 10 次使用）
   → 閒置時間遠大於建立時間，pool 變浪費

資源生命週期短
   → 用一次就丟比較簡單
```

簡單的 CLI 工具連 DB 用完就斷、跑完就退出，不需要 pool。低流量內部工具同理。

過早引入 pool 是常見的 over-engineering：增加 stale connection、reset bug、pool size tuning 三類新問題，但實際省下的時間幾乎為零。

---

## 當 pool 還不夠：JVM 的升級階梯

物件池是第一層解法。對 web 服務、後台 ETL 這種 latency 容忍度幾十毫秒的場景，加一個 ring buffer 就夠了。

但「**每筆訂單晚 1 毫秒可能漏掉百萬**」的高頻交易場景不一樣。物件池只擋 transient allocation，擋不住「資料量本身就大」這件事。訂單簿可能有上億筆 entry，全放 heap 會把 old generation 撐爆，full GC 一觸發就停半秒，比 minor GC 還恐怖。

這時候需要往下走。

### Off-heap：把資料搬出 GC 視野

```text
ByteBuffer.allocateDirect(1024 * 1024 * 1024);
   → JVM 內部呼叫 malloc(1 GB)
   → OS 給一塊 1 GB 的 native memory
   → 這塊 memory 在 JVM process 內，但在 heap 之外
   → GC 完全看不到，自然不掃、不暫停
```

關鍵釐清：「Off-heap」不是 stack。它是 JVM process 拿到的另一塊 native memory，由 OS 直接分配。Stack 是 per-thread 的函式呼叫工作區（~1 MB）；off-heap 可以幾 GB，存任意資料，跨 thread 共用。兩者完全是不同的東西。

實務 library：

```text
Chronicle Map     — off-heap key-value store
Chronicle Queue   — off-heap 訊息隊列 + memory-mapped file 持久化
Aeron             — off-heap UDP messaging（交易所等級）
Netty ByteBuf     — off-heap 網路 buffer（多數高效能 server 底層）
```

代價：失去 Java 物件模型。off-heap 那塊只是 bytes，要自己決定 byte layout、自己序列化反序列化。API 像在寫 C，沒有 method、沒有 type 檢查，debug 也辛苦。

### 挑對 collector：暫停短一點

前兩層都做完還不夠，才挑 collector：

```text
ZGC          — 暫停目標 sub-millisecond
Shenandoah   — 同樣的低暫停定位（Red Hat 主導）

舊版 Parallel / CMS / G1 在低延遲場景已經被淘汰。
```

但 collector 排在最後，不是最先。原因：collector 只讓**現有的 GC 暫停更短**，沒減少 allocation pressure。前兩層才是「**讓 GC 沒事做**」，第三層只是「**讓 GC 暫停短一點**」。真正省的不是把 GC 做快，是讓它一開始就沒什麼要做。

先挑 collector 幾乎都是順序搞反。

### 換語言：JVM 不是對的選擇

做到這裡還不夠，意味著 JVM 本身不是對的工具：

```text
Rust    — 無 runtime GC，ownership 編譯期管理
C++     — 手動管，完全可控
FPGA    — 硬體層級匹配訂單，nanosecond 級
```

業界做最低延遲的做市商核心，根本不在 JVM 上跑。Java 出現是因為團隊熟、ecosystem 大，**不是效能上限高**。

### 升級階梯總覽

| 層級 | 工程成本 | 收益方向 | 適用場景 |
|---|---|---|---|
| 物件池 / ring buffer | 中（一個 component 改寫） | 減少 transient allocation | latency 預算幾毫秒以下 |
| Off-heap | 高（API 風格大改、debug 變難） | 大資料逃離 GC 視野 | 訂單簿、行情快照、tick log |
| 換 collector | 低（改 JVM flag） | 暫停時間從十幾毫秒降到 sub-ms | 前兩層都做完仍不夠 |
| 換語言 | 極高（rewrite） | 完全擺脫 GC | 真的逼到極限 |

每一階上去，工程複雜度大概乘 10。但 latency 改善是邊際遞減的。前兩層常常就把 99% 的問題解掉，後兩層只是把那剩下的 1% 再壓下去。

---

## 進階：Pool of Pools

大型系統常常多層 pool 疊起來：

```text
[App Server]
  └── 應用內物件池（Disruptor / Netty ByteBuf）
       └── 應用內連線池（HikariCP）
            └── 中介連線池（PgBouncer）
                 └── PostgreSQL 真連線
```

每一層都在做 resource pool，但 resource 不同：

```text
HikariCP   borrow → 「對 PgBouncer 的連線」
PgBouncer  borrow → 「對 PG 的連線」
PG         處理 query → 跑 backend process
```

四層每層省一次握手 / 一次建立成本。end-to-end 從 50 ms 降到 1 ms。

副作用：debug 難度跟著乘起來。連線出錯時，要知道是哪一層的 pool 出問題、哪一層在 reset 狀態、哪一層命中失敗。

---

## 同一個模式，三套實作

連線、物件、HTTP 是三個世界的東西。但 pool 的邏輯一致：

```text
1. 建立成本貴
2. 預先建好一批
3. 反覆借還
4. 歸還時做必要清理
5. 失效時偵測重建
```

差別只在第 4 步「清理多深」，而清理多深取決於「下個用的是誰」。

```text
DB pool       下個是別人 → 全部清掉
JVM 物件池    下個是同一 process 的下一筆 → 輕量 reset
Browser TLS   下個還是同一個 browser → 盡量留著
```

理解這個分歧，你會在看到 `DISCARD ALL`、`reset()`、QUIC `Session Ticket` 時立刻知道為什麼這樣設計。

PG 連線池的具體機制（PgBouncer 三種 mode、SET search_path 陷阱）詳見 [連線不是免費的](db-connections)。每一層的延遲量級對照詳見 [資料在哪一層拿到](latency-hierarchy)。

---

## References

- [Measuring the Memory Overhead of a Postgres Connection](https://blog.anarazel.de/2020/10/07/measuring-the-memory-overhead-of-a-postgres-connection/) — Andres Freund 實測：每連線記憶體開銷準確算 <2 MiB（huge_pages=on ~1.3 MiB、off ~7.6 MiB）。`ps`/`top` 會把共用記憶體算進每個 process，誤報成十幾 MB 甚至 GB 級。
- 文中各項 ms（DNS / TCP / TLS 握手 / HTTP 首連 ~170 ms / backend fork ~20 ms）是示意。握手成本本質是 RTT 的倍數，隨網路距離變動；fork、GC 暫停隨硬體與設定不同。量級對，絕對值別當定值。
