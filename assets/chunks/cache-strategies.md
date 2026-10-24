---
title: "Cache Strategies"
slug: cache-strategies
brief: "Cache-aside、write-through、write-behind。每種都有 stale window。"
date: 2026-03-31
updated: 2026-10-17
revisions: 3
article: cap-cache-acid
---

# Cache Strategies

> 系統加了 cache 之後，讀的時候先查 cache 還是 DB？寫的時候先更新哪一邊？

## 讀策略

### Cache-Aside（旁路快取）

Application 自己管 cache。讀取時先查 cache，miss 再查 DB，查到後寫回 cache。

```text
1. GET cache("user:42")  → miss
2. SELECT * FROM users WHERE id=42  → 找到
3. SET cache("user:42", data, TTL=30min)
4. 回傳 data
```

下次讀 "user:42" 就直接從 cache 取得，不碰 DB。

這是最常見的模式。Redis + MySQL 的標準組合幾乎都用 cache-aside。

**問題**：DB 更新後 cache 還是舊的，直到 TTL 過期或手動刪除。這段時間讀到的是 stale data。

### Read-Through

概念是「cache 層自己去查 DB，application 只跟 cache 溝通」。但這個模式要求 cache 系統本身**有能力連 DB、知道怎麼查**。

**純 Redis 做不到 read-through**。Redis 是 key-value store，沒有「miss 時去 DB 取資料」的 callback 機制。

真正能做 read-through 的三種情境：

**1. 有 loader 的 in-process cache**（Caffeine / Guava）

```java
LoadingCache<Long, User> cache = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(30, MINUTES)
    .build(userId -> userRepository.findById(userId));  // ← loader

User u = cache.get(42L);  // miss 時 library 自動呼叫 loader
```

把 loader function 註冊給 library 之後，library 會在 miss 時自動呼叫它。從 application code 看就是 read-through，只是查 DB 的 loader 還是 application 自己寫的。

**2. 綁定特定 DB 的託管 cache**（AWS DAX）

DAX 是 DynamoDB 專用的 cache layer，miss 時自動回 DynamoDB 取資料。App 只呼叫 DAX，完全不接觸 DynamoDB。這是原生的 read-through。

**3. CDN**

CDN 節點 miss 時自動回源站取得內容，application 不需要知道。

### Redis + MySQL 幾乎都是 cache-aside

Redis 沒有 loader 機制，所有 cache miss 後的邏輯都在 application code 裡。有人把這種模式口語上叫 read-through，嚴格講法是 cache-aside。

## 寫策略

### Write-Through

寫入時同時更新 cache 和 DB。兩邊都寫完才算成功。

```text
1. 更新 cache("user:42", newData)
2. UPDATE users SET ... WHERE id=42
3. 兩邊都成功 → 回傳 OK
```

**好處**：cache 永遠是最新的，沒有 stale data。
**代價**：每次寫入都多一次 cache 操作，延遲變高。而且如果這筆資料根本沒人讀，寫進 cache 也是浪費。

### Write-Behind（Write-Back）

寫入時只更新 cache，不馬上寫 DB。cache 累積一批之後，背景非同步寫入 DB。

```text
1. 更新 cache("user:42", newData) → 立刻回傳 OK
2. （背景）累積到一定量或一定時間 → batch 寫入 DB
```

**好處**：寫入延遲極低，batch 寫入減少 DB 壓力。
**代價**：cache 掛了、還沒寫入 DB 的資料就丟了。只適合能容忍少量資料丟失的場景（例如 view count、按讚數）。

### Write-Around

寫入時只更新 DB，不動 cache。下次讀取 miss 時再從 DB 載入。

```text
1. UPDATE users SET ... WHERE id=42 → 回傳 OK
2. cache 裡的舊資料等 TTL 過期自然消失
```

適合寫多讀少的資料。剛寫入的資料不一定馬上會被讀，沒必要佔 cache 空間。

## 五個怎麼分

### miss 跟寫回 DB，誰處理

```text
cache 自己連線到 DB，app 只跟 cache 講話    Read-Through、Write-Through、Write-Behind
app 自己連線到 DB，cache 只是 key-value      Cache-Aside、Write-Around
```

名字裡有 through 的，請求穿過 cache 到 DB，所以 cache 自己要有 DB 的連線。Write-Behind 名字沒有 through，也在這一組，因為寫回 DB 的排程在 cache 裡。另一組的 cache 是被動的 key-value store，查 DB、回填、刪 key 全寫在 app 的程式碼裡，Redis 就是這種。

### 寫入什麼時候到 DB

```text
同步     Write-Through   cache 和 DB 都寫完才回 OK
非同步   Write-Behind    寫完 cache 就回 OK，稍後批次寫 DB
跳過     Write-Around    直接寫 DB，cache 等下次 miss 再回填
```

Cache-Aside 的寫入通常是「寫 DB，然後刪 cache key」，等於 Write-Around 多一個刪 key 的動作，舊值不用等 TTL。

### 為什麼 Read-Through 常配 Write-Through

兩個都要 cache 自己連線到 DB。有了那一層（DAX、Hibernate 二級快取），讀寫自然都交給它。反過來 Cache-Aside 配寫 DB 刪 key，兩邊都是 app 自己處理，Redis + MySQL 幾乎都這樣。Write-Behind 多半單獨用在計數器這種寫多、少幾筆沒關係的資料。

## 怎麼選

| 場景 | 策略 | 理由 |
|---|---|---|
| 一般 CRUD | Cache-aside + write-around | 簡單，讀多寫少的資料自然會進 cache |
| 讀極多、一致性要求高 | Read-through + write-through | cache 永遠最新 |
| 寫極多、容忍丟資料 | Write-behind | 按讚數、瀏覽數 |

大部分系統用 cache-aside 就夠了。

---

cache 沒有回應、請求直接進到 DB 時會發生什麼（雪崩、穿透、擊穿），寫在 [Cache Stampede](chunk://cache-stampede)。

