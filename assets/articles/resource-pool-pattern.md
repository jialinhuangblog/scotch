---
title: "同樣是 pool，為什麼請求結束後，有的把連線歸還、有的原封不動留著？"
slug: resource-pool-pattern
subtitle: "DB 連線池、JVM 物件池、瀏覽器 HTTP keep-alive 是同一個模式。DB 連線歸還時清掉 session 狀態，因為下一個借用者可能是別的租戶；瀏覽器把 TLS 金鑰留著，因為下次用的還是同一個人。"
chapter: "buffer"
tags: [connection-pooling, object-pool, http2, http3, quic, performance]
date: 2026-05-04
updated: 2026-06-11
revisions: 1
related: [db-connections, latency-hierarchy, cache-hot-key, browser-connection-reuse]
---

# 同樣是 pool，為什麼請求結束後，有的把連線歸還、有的原封不動留著？

建一條 PostgreSQL 連線要 **50 毫秒**。發一個全新的 HTTP 請求要 **170 毫秒**。new 一個 Java 物件本身只要 70 奈秒，便宜到可以忽略。

但每秒 new 一百萬個，光 allocation 就累積 70 毫秒。再加上 GC 觸發 stop-the-world 暫停 5 到 50 毫秒，整個 request budget 就用完了。

三個成本都落在毫秒級。解法也是同一個：**預先建好，反覆借還**。

DB 連線池歸還時會把 session 狀態清乾淨。瀏覽器則把跟 server 之間的金鑰、ticket、protocol 偏好都留著，下次連同一個 server 直接 0-RTT 開始傳。

都是 pool，為什麼 DB pool 歸還時清乾淨，browser 卻全留著呢？

---

## 共同的成本結構

三種資源的成本結構一樣：

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

如果每次用完就銷毀，下一個使用者要從頭再花一次建立成本。

三種資源各自的建立成本：

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

PG 特別貴在最後一步：每條連線一個 process。連 100 條就是 100 個 process，排程跟 context switch 都有成本。記憶體每條實測大約 1 到 8 MB（看 huge_pages 設定，ps/top 常把共用記憶體算進去而高估）。詳細的 PG process 模型見 [DB 連線為什麼不能想開幾條就開幾條](article://db-connections)。

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

單一個物件很便宜。**新物件累積成 GC 壓力**才是真正的成本。

大量短命物件造成的 GC 壓力，可以用物件池處理。但長期持有的大量資料（訂單簿、tick history、報價快照）要用別的做法，見後面 off-heap 那一節。

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

## 歸還時要不要 reset

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

LMAX Disruptor 是 Java 的高效能 ring buffer library，它更省，**完全不主動 reset**。生產者寫進 slot 時直接覆蓋舊內容，省一層清空動作。

理由：**同一個物件不應該帶舊資料給下個訊息**，但 thread safety 邊界明確（單寫者、ring buffer 順序消費），不需要清那麼乾淨。

### Browser TLS Session：盡量留著

完全反方向。瀏覽器跟 server 之間的 session ticket、Alt-Svc、QUIC 0-RTT 金鑰，全都留著。下次連同一個 server 直接用。

```text
首次連 example.com：
   完整 TLS 1.3 握手（1 RTT）
   Server 回 NewSessionTicket → 裡面是之後重連用的 PSK（pre-shared key）
   Browser 存：example.com 的 ticket
   Browser 存：Alt-Svc 標頭說對方支援 HTTP/3

二次連 example.com（ticket 還沒過期）：
   Browser 帶著 ticket：「我之前連過」
   Server 用自己的 session ticket key 解開 ticket → 拿到 PSK
   不用再傳送跟驗證 certificate
   → 還是 1 RTT，但省掉憑證那段的傳輸跟運算
     （TLS 1.2 的完整握手要 2 RTT，resumption 才降到 1 RTT）

0-RTT 更進一步（TLS 1.3 跟 QUIC 都有）：
   Browser 第一個 packet 就帶用 PSK 加密的 HTTP request（early data）
   Server 解開 ticket 就能 decrypt
   → 不等握手完成就開始處理 request
```

理由：**同一個 browser 一直是「同一個人」**。記得越多越快，沒有跨使用者污染問題。

---

## 為什麼方向相反：DB 連線會換人用，browser 不會

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

決定方向的是**使用者邊界**：

| 場景 | 借用者邊界 | 設計取向 |
|---|---|---|
| DB pool | 跨使用者（server-side 共用） | 清 |
| JVM 物件池 | 跨訊息（同 process 內） | reset |
| Browser TLS | 同使用者（browser 私有） | 留 |

JVM 物件池在中間：邊界比 DB 窄（同一個 process 內），但比 browser 寬（不同訊息共用），所以做最輕量的 reset。

---

## Pool 不是無限可靠

每個實作都要處理「資源變壞」。

### DB pool：stale connection

連線可能因為 server idle timeout、網路 blip、防火牆關掉而失效。Client 不知道，借出去送 query 才發現對方已斷。

HikariCP 是 Java 最常用的 DB 連線池，相關設定：

```text
HikariCP 設定：
   connectionTestQuery: 'SELECT 1'   ← 借出前先 ping（JDBC4 driver 可以不設，改用 Connection.isValid()）
   validationTimeout:   5000 ms
   maxLifetime:         30 min        ← 連線太老主動丟掉重建
```

`maxLifetime` 是第二道保險，就算連線還能用也定期換新，避免長期連線的隱性 bug 累積。

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

Session ticket 有 expiry，長度由 server 決定，TLS 1.3 規定最長 7 天。過期就退回完整握手。

0-RTT 還有 replay attack 的風險。攻擊者重送之前那份加密 request，server 分辨不出是新的還是舊的。所以多數 server 對 POST、DELETE 等狀態變更請求**禁止 0-RTT**，只允許 GET 等 idempotent 操作。

---

## Pool 的代價：不是免費優化

每種 pool 都有 trade-off。

### DB pool

```text
✗ ORM 不知道背後換連線
   → SET search_path 在 transaction 結束後失效
   → 多租戶 schema 路由錯誤
✗ Long transaction 卡住 pool
   → 可用的連線數實際變少
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
✗ Session ticket 加密金鑰外洩
   → TLS 1.3 用 psk_dhe_ke 恢復的連線還有 forward secrecy，但 0-RTT 的 early data 沒有
   → TLS 1.2 的 ticket 裡直接放 master secret，整段 session 都能被解密
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

太早引入 pool 會多出 stale connection、reset bug、pool size 調校這些新問題，實際省下的時間卻幾乎為零。

---

## JVM 的下一步：off-heap、換 collector、換語言

物件池是第一層解法。對 web 服務、後台 ETL 這種 latency 容忍度幾十毫秒的場景，加一個 ring buffer 就夠了。

但「**每筆訂單晚 1 毫秒可能漏掉百萬**」的高頻交易場景不一樣。物件池只處理短命物件，處理不了資料量本身就大的情況。訂單簿可能有上億筆 entry，全放 heap 會把 old generation 塞滿，一觸發 full GC 可能停上好幾百毫秒，比 minor GC 嚴重得多。

### Off-heap：把資料搬出 GC 視野

```text
ByteBuffer.allocateDirect(1024 * 1024 * 1024);
   → JVM 內部呼叫 malloc(1 GB)
   → OS 給一塊 1 GB 的 native memory
   → 這塊 memory 在 JVM process 內，但在 heap 之外
   → GC 完全看不到，自然不掃、不暫停
```

Off-heap 不是 stack。它是 JVM process 拿到的另一塊 native memory，由 OS 直接分配。Stack 是每個 thread 自己的函式呼叫工作區（約 1 MB），off-heap 則可以有幾 GB，存任意資料，也能跨 thread 共用。

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

CMS 在 JDK 14 已經移除。
Parallel 跟 G1（預設）還在，但暫停時間比不上上面兩個。
```

collector 排在最後，因為它只**縮短暫停**，沒減少 allocation pressure。前兩層減少的是 GC 要做的工作量。

### 換語言：JVM 不是對的選擇

做到這裡還不夠，意味著 JVM 本身不是對的工具：

```text
Rust    — 無 runtime GC，ownership 編譯期管理
C++     — 手動管，完全可控
FPGA    — 硬體層級匹配訂單，nanosecond 級
```

業界做最低延遲的做市商核心，根本不在 JVM 上跑。Java 會被採用是因為團隊熟、ecosystem 大，**不是效能上限高**。

### 四層對照

| 層級 | 工程成本 | 收益方向 | 適用場景 |
|---|---|---|---|
| 物件池 / ring buffer | 中（一個 component 改寫） | 減少 transient allocation | latency 預算幾毫秒以下 |
| Off-heap | 高（API 風格大改、debug 變難） | 大資料逃離 GC 視野 | 訂單簿、行情快照、tick log |
| 換 collector | 低（改 JVM flag） | 暫停時間從十幾毫秒降到 sub-ms | 前兩層都做完仍不夠 |
| 換語言 | 極高（rewrite） | 完全沒有 GC | 前三層都做了還不夠 |

工程成本沒有一層比一層高：換 collector 只改一個 JVM flag，排在 off-heap 後面，是因為它只縮短暫停，沒減少 GC 的工作量。前兩層通常就解決了大部分問題。

---

## 進階：Pool of Pools

大型系統常常有好幾層 pool：

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

每一層各省掉自己那次建立成本，end-to-end 從 50 ms 降到 1 ms。

副作用是 debug 變難。連線出錯時，要先找出是哪一層的 pool 出問題。

---

## 同一個模式，三套實作

連線、物件、HTTP 是三種不同資源，但 pool 的邏輯一致：

```text
1. 建立成本貴
2. 預先建好一批
3. 反覆借還
4. 歸還時做必要清理
5. 失效時偵測重建
```

差別只在第 4 步清理多深：

```text
DB pool       下個是別人 → 全部清掉
JVM 物件池    下個是同一 process 的下一筆 → 輕量 reset
Browser TLS   下個還是同一個 browser → 盡量留著
```

PG 連線池的具體機制（PgBouncer 三種 mode、SET search_path 的問題）見 [DB 連線為什麼不能想開幾條就開幾條](article://db-connections)。每一層的延遲量級對照見 [資料放 CPU cache 還是放磁碟，讀取速度差好幾個數量級](article://latency-hierarchy)。

---

## References

- [Measuring the Memory Overhead of a Postgres Connection](https://blog.anarazel.de/2020/10/07/measuring-the-memory-overhead-of-a-postgres-connection/) — Andres Freund 實測：huge_pages=on 時每條連線約 1.3 MiB，off 時約 7.6 MiB。`ps`/`top` 會把共用記憶體算進每個 process，誤報成十幾 MB 甚至 GB 級。
- 文中各項 ms（DNS / TCP / TLS 握手 / HTTP 首連 ~170 ms / backend fork ~20 ms）是示意。握手成本本質是 RTT 的倍數，隨網路距離變動；fork、GC 暫停隨硬體與設定不同。數量級可以參考，絕對值會隨環境變動。
