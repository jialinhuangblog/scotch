---
title: "方向"
slug: direction
subtitle: "I → T → π。這個 gallery 背後的學習路徑。"
chapter: "extras"
tags: [meta, direction, learning-path]
related: [direction-frontend]
---

# 方向

常見的學法是衝著面試去，背 20 個 building blocks、在白板上畫方塊，面試過了就停下來，離 architect 還很遠。

---

## 2.1 我的路徑：前端工程師成為 Architect

### I → T → π

**I** 是一條垂直線。在一個領域深入到底。我的是前端：component 架構、rendering pipeline、瀏覽器內部、效能預算。

**T** 是同樣的深度加上一條寬廣的水平線，能跟每個團隊溝通。我是靠接觸後端 CRUD、資料庫、Kubernetes、OSI 層級的網路走到這裡，程度是能聊，不是專家。

**π** 是兩條以上的深度垂直線加上廣度，能跨領域設計。這是目標。第二條腿需要跟第一條一樣深。System design 就是那第二條腿。

### 目前的深度地圖

| 領域 | 深度 | 狀態 |
|---|---|---|
| 前端 / UI 架構 | 深 | 已建立。這是第一條垂直線。 |
| k8s / 容器編排 | 中深 | 進行中。已經在追蹤 etcd、Raft、CRI/CNI。 |
| 網路 / OSI | 中 | 進行中。理解 L4/L7、gRPC over HTTP/2。 |
| 資料庫 / 儲存 | 淺中 | CRUD 等級。會 SQL，不懂 storage engine。 |
| 分散式系統 | 淺 | 知道術語。還沒追蹤因果關係。 |

### 第二條腿

四個領域把 T 變成 π：

1. **Storage engines。** Postgres 怎麼寫到磁碟？什麼是 WAL？B-Tree 跟 LSM-Tree 的差別，會決定一個查詢是 2ms 還是 200ms 完成。

2. **共識與複製。** k8s 依賴 etcd，etcd 依賴 Raft，這條依賴鏈本來就在，順著往下走就好。

3. **串流與事件驅動架構。** Kafka 不是 message queue。它是一個 append-only log，剛好支援 pub/sub。理解 log 之後，CDC、event sourcing，還有微服務為什麼能運作（或不能），都會比較好懂。

4. **系統層級的網路。** TCP 擁塞控制。連線池。為什麼 gRPC 選了 HTTP/2。Envoy 怎麼在 service mesh 裡攔截流量。

---

## 2.2 典型學習路徑

同一批材料，四種工程師從不同的地方開始走。

### 路徑 A：後端工程師 → Architect

後端工程師已經熟悉資料庫、API 和 server 端邏輯，缺的是水平那條線，也就是廣度。

```
起點：深入一個後端技術棧（例如 Java + Postgres + Redis）
→ 學分散式系統理論（共識、複製、分區）
→ 加基礎設施（k8s、網路、可觀測性）
→ 加資料管線（Kafka、串流、批次處理）
→ 研究跨領域議題（安全、成本、組織取捨）
→ Architect
```

**優勢：** 後端工程師平常就在處理伺服器、延遲跟故障，分散式系統理論講的就是他們見過的問題。

**風險：** 可能低估前端的效能限制跟使用者那端的延遲預算。也可能把內部系統做得太複雜，因為他們沒處理過首頁要 3 秒才畫出來的問題。

### 路徑 B：前端工程師 → Architect（這是我的）

前端工程師熟悉 rendering、狀態管理和瀏覽器 API，缺的是往下那條垂直線：HTTP response 以下的一切。

```
起點：深入前端（Angular、React、瀏覽器內部、效能）
→ 學後端基礎（CRUD、REST、auth、server 框架）
→ 選一個基礎設施的好奇心然後深入（我選 k8s）
→ 順著依賴鏈往下走（k8s → etcd → Raft → 共識）
→ 用 building blocks checklist 填補廣度缺口
→ Architect
```

**優勢：** 前端工程師理解使用者，知道使用者那端的「快」是幾毫秒。他們會去想快取、CDN 失效跟感知效能，因為在 Lighthouse 分數跟 Core Web Vitals 裡量過。

**風險：** 整個後端一開始是黑盒子，腦中的模型就是「API 回傳資料」。Storage engine、複製延遲、isolation level、交易保證，這些全在 HTTP response 後面，不去追就碰不到。

### 路徑 C：SRE/DevOps → Architect

SRE 已經熟悉基礎設施、監控和事件回應，每週都看到系統故障。缺的是設計意圖，也就是系統當初為什麼這樣設計。

```
起點：深入基礎設施（Linux、網路、k8s、Terraform、可觀測性）
→ 學系統為什麼被設計成這樣（讀 RFC、設計文件）
→ 加資料庫內部（storage engine、複製、一致性模型）
→ 加應用層 pattern（event sourcing、CQRS、saga）
→ 研究塑造架構的產品和商業限制
→ Architect
```

**優勢：** SRE 把 99.999% 的[可用性](chunk://sla-slo)當成一筆預算在花，換算下來一年大概只能停五分鐘。

**風險：** 可能只盯著運維面，漏掉造成運維麻煩的應用層設計，結果只修症狀，沒回頭改掉原因。

### 路徑 D：應屆畢業生 → System Design 面試

應屆畢業生有演算法、資料結構，可能一次實習。缺口是單一 process 以上的一切。

```
起點：學 10 個 building blocks（load balancer、cache、CDN、queue、DB 等）
→ 練 10-15 個經典設計題（URL 縮短器、Twitter、聊天）
→ 學問澄清問題和估算規模
→ 完整讀一本書（Alex Xu 或 DDIA）
→ 做 mock interview 直到 45 分鐘的節奏感覺自然
→ 通過面試
```

**優勢：** 沒有先入為主的做法，新學的面試框架不會跟既有的理解衝突，所以學得很快。

**風險：** 有廣度沒深度。學到「這裡用 cache」，但不理解 cache invalidation、eviction policy 或 thundering herd。

---

## 2.3 我的路徑有什麼不同

典型的面試路徑是廣度優先：

```
學 20 個 building block 名稱 → 在白板上組合它們 → 通過 → 停下
```

我的路徑是深度優先：

```
用一個真實系統（k8s）→ 問為什麼（「Pod 為什麼重啟？」）
→ 追依賴鏈（controller → reconciliation loop → etcd → Raft）
→ 碰到根本問題（「分散式節點怎麼達成共識？」）
→ 從那個基礎水平擴展
```

**1. 起點是好奇心，不是課程大綱。** 我沒有從教科書第一章開始。我從已經有問題的地方開始：k8s 天天在用，疑問本來就在，順著追下去而已。

**2. 深度優先走得慢，但每個主題都追到底。** 廣度優先的學法一個月走 20 個主題，我同樣時間只走 4 個。可是走到共識的時候，我已經從 Pod 重啟一路追到 etcd、Raft、FLP 不可能定理。廣度優先學到的是「Raft 是一個共識演算法」，我知道的是 Raft 為什麼存在，還有它解決不了什麼。

**3. 風險是盲點。** 前端很深，k8s 追到中深，但對 CDN 失效或 rate limiter 演算法一無所知。Building blocks checklist（第 2.8 節）就是用來找深度優先漏掉的主題。

---

## 2.4 自學 vs 結構化學習

這個 gallery 是自學寫出來的，但自學有幾種固定的失敗方式，結構化學習剛好能補上。

### 自學遺漏的

**順序。** 教科書把 isolation level 放在 storage engine 之後，因為要先懂 WAL 和 MVCC。自學的時候可能直接跳到 isolation level，搞混了，花一週繞回去補。DDIA 的章節順序不是隨意排的，它是一個依賴圖。

**未知的未知。** 不知道某個概念存在，就不會想到去搜尋它。我是讀到 leaderless replication 裡的衝突解決，才知道 vector clock 重要。結構化課程會在用到之前先把這些提出來。

**反饋迴路。** 寫一篇關於 Raft 的文章感覺很完整，直到有人問：「當 leader 和 follower 有衝突的 log 時會怎樣？」自學的時候沒有人會問這種問題，mock interview、讀書會和 code review 才會有人問。

**校準。** 自學者要嘛高估（「我讀了 Raft 論文，我理解共識」）要嘛低估（「我無法在 30 秒內解釋 CAP，我什麼都不知道」）。結構化課程有同儕可以比較，比較容易知道自己在哪個程度。

### 結構化學習遺漏的

**來自真實問題的動機。** 課程指定「第七章：分區」。我是因為 Kafka consumer group 停止擴展才接觸到分區。先有問題再學到的概念比較記得住，因為它解決過一個真實的問題。

**一手來源的閱讀能力。** 課程直接給答案。讀 Kafka KIP、CockroachDB RFC 這種一手來源的能力，要自己找答案才能練出來，課程很少教。

**寫作的習慣。** 自學的時候得把每個概念解釋給自己聽，寫下來就成了這個 gallery。

### 最佳組合

先照 DDIA 的章節順序讀，讀到有疑問的地方再自己去翻 RFC、追程式碼，寫出來之後拿去 mock interview 或讀書會讓人挑錯。

---

## 2.5 資源評估

### 書籍

#### DDIA — Designing Data-Intensive Applications（Martin Kleppmann）

被引用最多的 system design 書。它不是面試書，是講基礎的書。

| 面向 | 評估 |
|---|---|
| **涵蓋** | Storage engine、複製、分區、交易、一致性、批次/串流處理 |
| **優勢** | 解釋*為什麼*系統被設計成這樣。追蹤取捨，不只是描述。章節順序是依賴圖：每一章建立在前一章之上。 |
| **弱點** | 內容密集，沒有練習題，也不按面試題目組織。 |
| **適合** | 任何想深入理解系統的人。也是這個 gallery 的基礎書。 |
| **結論** | 必讀，照章節順序讀。 |

#### System Design Interview（Alex Xu，第 1 和 2 冊）

面試準備最常用的一套。每章走過一個設計問題的完整流程。

| 面向 | 評估 |
|---|---|
| **涵蓋** | Rate limiter、URL 縮短器、聊天系統、通知系統、動態消息等。 |
| **優勢** | 教面試格式：需求、估算、高階設計、深入探討。圖表清晰。對初學者友善。 |
| **弱點** | 重廣度輕深度。解釋*用什麼*，很少解釋*為什麼那樣運作*。讀完會畫一個標著「Message Queue」的方塊，但講不出 Kafka 底下是一條 append-only log。 |
| **適合** | 應屆畢業生和任何 4-8 週內有面試的人。 |
| **結論** | 適合起步。只停在這本，學到的是格式不是機制。 |

### GitHub Repositories

#### donnemartin/system-design-primer

47 個主題。圖表。Anki 閃卡。GitHub 上最多星的 system design repo。

| 面向 | 評估 |
|---|---|
| **優勢** | 全面的參考。適合查忘記的概念。取捨表（SQL vs NoSQL、cache-aside vs write-through）是有用的快速參考。 |
| **弱點** | 設計上就是廣度優先。每個主題 1-2 頁。主題之間沒有因果關係。consistent hashing 和 load balancing 分在兩頁講，不會提到兩者之間誰啟發了誰。 |
| **適合** | 字典。查概念，然後在其他地方深入。 |

#### karanpratapsingh/system-design

Markdown 格式的結構化課程。涵蓋理論和元件，然後是設計問題。

| 面向 | 評估 |
|---|---|
| **優勢** | 好讀，章節組織清楚。讀 RFC 或 DDIA 之前，可以先用它熟悉詞彙。 |
| **弱點** | 淺。每個主題是摘要，不是解釋。適合第一次接觸，要真的理解還不夠。 |
| **適合** | 預習。瀏覽一章學詞彙，然後讀一手來源。 |

### 影片 / 平台

#### ByteByteGo（Alex Xu）

動畫 system design 解釋。部落格文章和 YouTube 影片。

| 面向 | 評估 |
|---|---|
| **優勢** | 動畫能把資料流一步一步畫出來，這是靜態圖表做不到的。適合建立請求在系統中怎麼移動的直覺。 |
| **弱點** | 跟書一樣深度不夠。動畫會演 load balancer 分配流量，但不會講 consistent hashing 演算法、virtual node 技巧，或節點故障時會發生什麼。 |
| **適合** | 視覺型學習者。看影片，然後讀 RFC。 |

### 一手來源

這些是建造系統的人寫的設計文件，不是教科書。每一份都寫了要解決的問題、考慮過但沒採用的做法，和最後選的設計。

#### Kafka KIPs（Kafka Improvement Proposals）

Kafka 的重大功能都是從一份 KIP 開始的。[KIP-500](https://cwiki.apache.org/confluence/display/KAFKA/KIP-500) 解釋了 Kafka 為什麼移除 ZooKeeper。

- [KIP 索引](https://cwiki.apache.org/confluence/display/KAFKA/Kafka+Improvement+Proposals)
- 原始碼：[apache/kafka](https://github.com/apache/kafka)

#### CockroachDB RFCs

分散式 SQL。isolation level、分散式交易、TTL 這些設計決策，每個都有一份 RFC，寫了脈絡、取捨和沒採用的做法。

- [所有 RFC](https://github.com/cockroachdb/cockroach/tree/master/docs/RFCS)
- [分散式 SQL RFC](https://github.com/cockroachdb/cockroach/blob/master/docs/RFCS/20160421_distributed_sql.md) — 如何把運算移到資料旁邊。
- [Read Committed Isolation RFC](https://github.com/cockroachdb/cockroach/blob/master/docs/RFCS/20230122_read_committed_isolation.md) — 為什麼加一個更弱的 isolation level 是對的。

#### etcd Raft 實作

k8s 依賴 etcd，etcd 依賴 Raft。設計文件寫了 Raft 論文怎麼變成 production 的程式碼。

- [etcd-io/raft](https://github.com/etcd-io/raft) — 從 etcd 抽出的 Raft 程式庫。
- [design.md](https://github.com/etcd-io/raft/blob/main/design.md) — etcd 怎麼實作 Raft。
- [raftexample](https://github.com/etcd-io/etcd/blob/main/contrib/raftexample/README.md) — 一個最小的 Raft-backed key-value store。

#### Kubernetes Design Proposals Archive

k8s 功能的歷史設計文件。現在的程式碼早就跟文件寫的不一樣了，但當初為什麼那樣設計，文件裡還是寫得很清楚。

- [kubernetes/design-proposals-archive](https://github.com/kubernetes/design-proposals-archive)
- [架構概覽](https://github.com/kubernetes/design-proposals-archive/blob/main/architecture/architecture.md)
- [設計原則](https://github.com/kubernetes/design-proposals-archive/blob/main/architecture/principles.md)

**為什麼一手來源重要：** 教科書寫 Raft 使用 leader election。KIP 寫的是 Kafka 為什麼改用自己的 leader election，取代 ZooKeeper 的那一套。教科書只有結論，KIP 有推理過程，碰到新問題時能拿出來用的是推理過程。

---

## 2.6 兩個學習哲學

這個 gallery 的結構來自兩個人的想法。

### Elon Musk：語義樹 — 結構可以規劃

> "It is important to view knowledge as sort of a semantic tree — make sure you understand the fundamental principles, i.e. the trunk and big branches, before you get into the leaves/details or there is nothing for them to hang on to."
> — Elon Musk, Reddit AMA, 2015

Musk 講的是**結構**。學東西要有順序。先主幹，再 branch，最後 leaves。沒有主幹，leaves 掛不住。

System design 的主幹不是「load balancer」或「cache」。主幹是：**你怎麼儲存資料、複製它，並在機器故障時保持一致？**

其他一切都是 branch 或 leaf：

```
主幹：儲存、複製、一致性
├── branch：共識（Raft、Paxos）
│   └── leaf：etcd 的 Raft 實作細節
├── branch：分區（hash、range）
│   └── leaf：Kafka consumer group rebalancing
├── branch：交易（ACID、isolation level）
│   └── leaf：CockroachDB 的 read committed RFC
```

面試資源大多從 leaves 開始，「設計一個 URL 縮短器」「設計一個聊天系統」都是。做完這些題，架構圖畫得出來，可是問到為什麼這裡要放 cache、為什麼要切 shard，就答不上來，因為儲存、複製、一致性那層沒學過。

這個 gallery 從主幹開始。每篇文章追蹤一條依賴鏈，從真實系統一路追到它解決的根本問題。

### Steve Jobs：Connecting the Dots — 回頭看才看見

> "You can't connect the dots looking forward; you can only connect them looking backwards. So you have to trust that the dots will somehow connect in your future."
> — Steve Jobs, Stanford Commencement, 2005

Jobs 講的是**時間軸**。書法課、被 Apple 開除、NeXT，這些經驗在當下看起來毫無關聯。十年後回頭看，dots 連成一條線。書法變成 Macintosh 的字體。被開除變成 Pixar。

這條線沒辦法規劃，只能事後回頭看見。

### 兩個不矛盾

Musk 說：規劃結構，先學主幹。
Jobs 說：別規劃路徑，回頭看自然會連。

這個 gallery 兩種做法都用：

- **Dependency chains = Musk 的樹。** k8s → etcd → Raft。有順序、有結構、刻意規劃的深度。
- **Building blocks grid = Jobs 的 dots。** DNS、Redis、rate limiter、CDN 現在一個一個學，不知道哪天會被哪個面試題或 production incident 串起來。

### 但不是每個 chunk 都是 dot

有些 chunk 確實是 dot，像 DNS、rate limiter、blob storage，先學哪個都行，沒有前後。但有些 chunk 是長在 branch 上的 **leaf**，要先懂別的 chunk 才看得懂。例如 isolation level 要先懂 WAL 和 MVCC，consumer group 要先懂 log 和 partition。這些不是 dot。把 leaf 當 dot 丟著，就重演 2.4 那個「跳到 isolation level，搞混，浪費一週」的失敗。

- **要先懂別的 chunk**：是 leaf，掛回 branch，放進 dependency chain，排在那些 chunk 後面。
- **不用先懂別的、放哪都行**：是 dot，維持游離，信任它哪天自己連起來。

### 規則：第一性原理勝過類比

類比是常見的學法：「Kafka 像是一個 message queue。」類比快但有漏洞。Kafka 不是 message queue，它是一個帶有 consumer offset 的 append-only log。類比把機制藏起來了，可是 Kafka 出問題時要查的正是 offset 跟 log，類比裡沒有這些。

第一性原理是把問題拆到最基本的事實，再往回推。不是「Kafka 像 X」而是「為什麼 append-only log 能解決傳統 queue 無法解決的問題？」

---

## 2.7 Building Blocks 聯集：四份參考的交叉比對

我不想寫到一半才發現別的 repo 列了我沒列的 building block，所以先把四份來源做一次完整的聯集。

四個來源：

1. **donnemartin/system-design-primer** — GitHub 最多星的 system design repo。47 個主題。百科全書式。
2. **karanpratapsingh/system-design** — Markdown 結構化課程。覆蓋最廣，從 OSI 到 OAuth 都有。
3. **Alex Xu · System Design Interview（Vol 1 + 2）** — 面試導向。每個 building block 嵌在設計題裡教。
4. **ByteByteGo** — 動畫 + 部落格。重視可觀測性和分散式 pattern。

### 四個來源各自的側重

**donnemartin** 的強項是通訊協議和可用性 pattern。它把 TCP、UDP、RPC、REST 當成獨立主題講，也是唯一把 back pressure 和 task queue 單獨列出的來源。弱點：沒有 rate limiter、consistent hashing、API gateway。

**karanpratapsingh** 覆蓋面最寬。從 IP/OSI 到 OAuth/SSO，從 CQRS 到 geohashing。它是唯一涵蓋安全（TLS、mTLS、OAuth）、架構 pattern（event sourcing、CQRS、EDA）和分散式理論（CAP、PACELC、distributed transactions）的來源。代價是每個主題都淺。

**Alex Xu** 的特色是把某些 building block 當成完整設計題來教。Rate limiter 不是一段描述，是一整章：需求分析、演算法比較、分散式部署。Unique ID generator 和 key-value store 也一樣。弱點：沒有 service discovery、reverse proxy、circuit breaker。

**ByteByteGo** 是唯一認真覆蓋運維面的來源：distributed tracing、distributed locking、distributed task scheduler、retry strategies。其他三個幾乎不碰這些。

### 四個都有的（核心 9 個）

四份資料都有這 9 個。只有時間學 9 個的話，就學這些。

| Building Block | 一句話 |
|---|---|
| DNS | 名稱解析。也用於負載均衡和故障切換。 |
| CDN | 邊緣快取。Invalidation 是難題。 |
| Load Balancer | L4 快，L7 能依 HTTP 內容路由。 |
| Cache | 讀取快，但有 stale data 風險。 |
| Message Queue | 解耦。Exactly-once 很難真的做到。 |
| Database（SQL） | ACID。Schema。Join。 |
| Database（NoSQL） | KV、document、wide column、graph。 |
| Database Replication | Leader-follower、multi-leader、leaderless。 |
| Database Sharding | Hash vs range。Resharding 很麻煩。 |

### 三個來源有的（高頻 6 個）

| Building Block | 哪三個有 | 一句話 |
|---|---|---|
| Consistent Hashing | karanpratapsingh, Alex Xu, ByteByteGo | 節點增減時只搬少量 key。 |
| Rate Limiter | karanpratapsingh, Alex Xu, ByteByteGo | Token bucket vs sliding window。保護下游。 |
| API Gateway | karanpratapsingh, ByteByteGo, donnemartin(隱含) | 單一入口。Auth 卸載、路由、限流。 |
| Reverse Proxy | donnemartin, karanpratapsingh, ByteByteGo | 跟 LB 和 API gateway 的邊界常搞混。 |
| Service Discovery | donnemartin, karanpratapsingh, ByteByteGo | 微服務怎麼找到彼此。DNS-based vs registry-based。 |
| REST / RPC / gRPC | donnemartin, karanpratapsingh, ByteByteGo | 通訊協議選擇。JSON vs protobuf。 |

### 各來源獨有或少見的

**只有 donnemartin 強調：**
- Back Pressure — 上游太快，下游怎麼喊停。
- Task Queue — 跟 message queue 不同：有 worker、有 retry、有排程。

**只有 karanpratapsingh 涵蓋：**
- OAuth 2.0 / SSO — 認證授權。其他來源當成「已知」跳過。
- CQRS / Event Sourcing — 讀寫分離到極致。
- CAP / PACELC — 分散式理論。其他來源提一句，這裡給一節。
- Distributed Transactions — 2PC、saga。
- Geohashing / Quadtree — 地理索引。

**只有 Alex Xu 當獨立章教：**
- Unique ID Generator — Snowflake、UUID。面試常考。
- Key-Value Store — 不只是「NoSQL 的一種」，是一整個設計題。
- Notification System — Push、SMS、email 的基礎設施。

**只有 ByteByteGo 認真覆蓋：**
- Distributed Tracing — 一個請求跨 10 個服務，怎麼追蹤。
- Distributed Locking — Redlock 和它的爭議。
- Circuit Breaker — 跟 rate limiter 互補。斷路器 vs 限流器。
- Retry Strategies — Exponential backoff、jitter。

### 結論：這個 gallery 的 building blocks 清單

首頁的 building blocks grid 放 infra 元件（白板上會畫成方塊的那些）。Pattern（consistent hashing、circuit breaker）和 theory（CAP、PACELC）放在 forest 的 chunks 裡。

---

## 2.8 Building Blocks Checklist

深度優先會有盲點，這個 checklist 用來把它們找出來。每一項列出我知道的，跟我還不能回答的。

| # | Building Block | 我知道的 | 我還不能回答的 |
|---|---|---|---|
| 1 | DNS | 知道解析鏈：stub → recursive → authoritative。 | DNS-based load balancing 怎麼運作？TTL 在新鮮度和延遲之間的取捨是什麼？ |
| 2 | CDN | 用過 CloudFront 做靜態資源。理解邊緣快取。 | Cache invalidation 怎麼在邊緣節點間傳播？什麼協議？什麼延遲？ |
| 3 | Load Balancer (L4/L7) | L4 按 IP/port 轉發封包。L7 讀 HTTP header 按 path/cookie 路由。 | Consistent hashing 在節點加入/離開時怎麼避免重新分配所有 key？ |
| 4 | Reverse Proxy | 知道 Nginx 可以當 reverse proxy。知道跟 LB 有重疊。 | Reverse proxy、LB、API gateway 三者的邊界在哪？什麼時候該合併？ |
| 5 | API Gateway | 用過 Kong 和 Nginx。知道路由、auth 卸載、rate limiting。 | API gateway 跟 service mesh ingress 的差異？什麼時候用哪個？ |
| 6 | Cache (Redis) | 用作 session store 和 key-value 快取。 | LRU vs LFU eviction：什麼時候 LFU 贏？Redis Cluster 怎麼處理 split-brain？ |
| 7 | Rate Limiter | 理解概念。知道它保護下游服務。 | Token bucket vs sliding window log：哪個更能處理突發流量，為什麼？ |
| 8 | Message Queue | 用過 RabbitMQ 做基本 pub/sub。 | Exactly-once delivery：是真的還是有用的虛構？Kafka 實際保證什麼？ |
| 9 | Database (SQL) | 會寫 CRUD。知道 index 加速查詢。 | WAL 怎麼保證 crash safety？B-Tree vs LSM-Tree 的讀寫放大差異？ |
| 10 | Database (NoSQL) | 知道 KV、document、wide column、graph 四種。 | 什麼場景下 wide column（Cassandra）贏過 document（MongoDB）？ |
| 11 | Database Replication | 知道 leader-follower 概念。 | Multi-leader 的衝突解決怎麼做？Leaderless（Dynamo-style）的 quorum 怎麼算？ |
| 12 | Database Sharding | 知道這個詞。知道它把資料分散到多個節點。 | Hash vs range partitioning：加一個 shard 時什麼會壞？怎麼不停機做 resharding？ |
| 13 | Blob Storage (S3) | 用過 S3 上傳檔案。 | S3 怎麼達到 11 個 9 的 durability？複製模型是什麼？ |
| 14 | Search (Elasticsearch) | 用於 log 彙整。 | Inverted index 怎麼在大規模下處理模糊搜尋？記憶體取捨是什麼？ |
| 15 | Service Discovery | 知道 k8s 用 DNS-based service discovery。 | Registry-based（Consul, etcd）vs DNS-based：什麼時候選哪個？ |
| 16 | Observability (Logs, Metrics, Traces) | 用過 ELK 看 log。知道 Prometheus 抓 metrics。 | Distributed tracing 怎麼在微服務間傳播 context？三者怎麼串起來做 root cause analysis？ |

每個「我還不能回答的」都是一篇還沒寫的文章。gallery 裡有文章回答了其中一個，就更新那一行。

---

## 2.9 兩種內容模式：Chunks 和 Articles

這個 gallery 要同時給廣度跟深度，兩種需要不同的格式。

### Chunks：抽屜裡的廣度

一個 chunk 是一個概念的簡短解釋。放在側面板裡。60 秒掃完。

Chunks 在 `src/assets/chunks/`，目前 130 個：`raft.md`、`b-tree.md`、`cap.md`、`mvcc.md`、`exactly-once.md` 等等。每個只講一個概念，不追依賴鏈，也不帶敘事。

**什麼時候用 chunk：** 讀 Kafka 的文章碰到「partition」，點開 chunk 看定義、圖跟取捨，關掉再繼續讀。

Chunks 是字典。

### Articles：整頁的深度

一篇文章追蹤因果關係。不是「什麼是 Raft」而是「沒有共識什麼會壞、Raft 怎麼解決、Raft 仍然無法解決什麼」。

Articles 在 `src/assets/articles/`。每篇跟隨一條依賴鏈：

```
k8s → etcd → Raft → 共識問題 → 網路故障 → 時鐘
Kafka → the log → 複製 → exactly-once → 分散式交易
Postgres → WAL → B-Tree → MVCC → isolation level → serializability
```

**什麼時候用 article：** 有 20 分鐘，想把一個系統從表面一路追到它解決的根本問題。

Articles 是教科書。

### 為什麼兩者都要

只有 chunks 的話，學到的是 20 個名詞，卻沒追過任何一條依賴鏈。只有 articles 的話，三條鏈追得很深，卻沒辦法一句話講清楚 CDN 是什麼。

---

## 第一批文章

| 順序 | 文章 | 為什麼這個順序 |
|---|---|---|
| 1 | k8s control plane / data plane / management plane | 從已經有好奇心的地方開始，先寫已經懂的部分，寫的過程中找出還不懂的。 |
| 2 | etcd 和 Raft | k8s 依賴它。順著依賴走。 |
| 3 | The Log（Kafka） | Jay Kreps 的 "The Log" 是串流架構的基礎。 |
| 4 | Storage engines：B-Tree vs LSM-Tree | 資料庫是我最淺的一塊，從這裡開始往下讀。 |
| 5 | Isolation levels | 建立在 storage engine 之上。連接到 CockroachDB RFC。 |
