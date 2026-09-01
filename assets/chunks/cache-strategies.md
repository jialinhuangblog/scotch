---
title: "Cache Strategies"
slug: cache-strategies
brief: "Cache-aside、write-through、write-behind。每種都有 stale window。"
date: 2026-03-31
updated: 2026-07-20
revisions: 2
---

# Cache Strategies

> 系統加了 cache 之後，兩個問題馬上浮出來：讀的時候先查誰？寫的時候先更新誰？

## 讀策略

### Cache-Aside（旁路快取）

Application 自己管 cache。讀取時先查 cache，miss 再查 DB，查到後寫回 cache。

```text
1. GET cache("user:42")  → miss
2. SELECT * FROM users WHERE id=42  → 找到
3. SET cache("user:42", data, TTL=30min)
4. 回傳 data
```

下次讀 "user:42" 就直接從 cache 拿，不碰 DB。

這是最常見的模式。Redis + MySQL 的標準組合幾乎都用 cache-aside。

**問題**：DB 更新後 cache 還是舊的，直到 TTL 過期或手動刪除。這段時間讀到的是 stale data。

### Read-Through

概念是「cache 層自己去查 DB，application 只跟 cache 溝通」。但這個模式要求 cache 系統本身**有能力連 DB、知道怎麼查**。

**純 Redis 做不到 read-through**。Redis 是 key-value store，它不知道你有 MySQL、不知道 table 長怎樣、也沒有「miss 時去某處拿資料」的 callback 機制。

真正能做 read-through 的三種情境：

**1. 有 loader 的 in-process cache**（Caffeine / Guava）

```java
LoadingCache<Long, User> cache = Caffeine.newBuilder()
    .maximumSize(10_000)
    .expireAfterWrite(30, MINUTES)
    .build(userId -> userRepository.findById(userId));  // ← loader

User u = cache.get(42L);  // miss 時 library 自動呼叫 loader
```

你把 loader function 註冊給 library，library 在 miss 時自動呼叫它。從 application code 看像 read-through，實質是 cache-aside 被 library 包起來。

**2. 綁定特定 DB 的託管 cache**（AWS DAX）

DAX 是 DynamoDB 專用的 cache layer，miss 時自動回去 DynamoDB 撈。App 只打 DAX，完全不接觸 DynamoDB。這是真正原生的 read-through。

**3. CDN**

CDN 節點 miss 時自動回源站拉，application 不需要知道。

### Redis + MySQL 幾乎都是 cache-aside

你平常寫的「先 GET cache，miss 再 query DB，然後 SET cache」就是 cache-aside。Redis 沒有 loader 機制，所有 cache miss 後的邏輯都在你的 application code 裡。有人把這種模式口語上叫 read-through，嚴格講法是 cache-aside。

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

適合寫多讀少的資料。剛寫入的東西不一定馬上會被讀，沒必要佔 cache 空間。

## 怎麼選

| 場景 | 策略 | 理由 |
|---|---|---|
| 一般 CRUD | Cache-aside + write-around | 簡單，讀多寫少的資料自然會被 cache |
| 讀極多、一致性要求高 | Read-through + write-through | cache 永遠最新 |
| 寫極多、容忍丟資料 | Write-behind | 按讚數、瀏覽數 |

大部分系統用 cache-aside 就夠了。

---

cache 沒擋住流量時會發生什麼（雪崩、穿透、擊穿），拆在 [Cache Stampede](chunk://cache-stampede)。

