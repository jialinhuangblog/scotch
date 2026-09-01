---
title: "短網址的 key 怎麼生，counter、hash、random 各有什麼問題"
slug: url-shortener-key
subtitle: "Hash？Counter？隨機？三條路各有各的坑，挑哪條看你在意什麼。"
chapter: "url-shortener"
tags: [url-shortener, hashing, base62, unique-id, bloom-filter]
date: 2026-03-21
related: [url-shortener-store, url-shortener-read, url-shortener-demo]
---

# 短網址的 key 怎麼生，counter、hash、random 各有什麼問題

問題很簡單：給一個長 URL，回傳一個短 URL；點短 URL 能 redirect 回原始的長 URL。

聽起來簡單，但整題只有一個問題要解：長 URL 怎麼變成一個 7 個字元的 short key。

---

## 7 個字元夠用幾年

短 URL 格式是 `https://short.url/<key>`。Key 用 a-z、A-Z、0-9（base62），7 個字元。

```text
62^7 = 3,521,614,606,208 ≈ 3.5 兆種組合
```

實際規模參考：Bitly 量級的服務每月縮短數億條 URL、產生上百億次點擊。下面用一個中等規模來算，例如每天 100 萬個。

```text
每天 100 萬：3.5 兆 ÷ 100 萬 ÷ 365 ≈ 9,600 年
每天 2000 萬（Bitly 等級）：3.5 兆 ÷ 2000 萬 ÷ 365 ≈ 480 年
```

即使是 Bitly 等級的量，7 個字元也能撐幾百年。

6 個字元？62^6 ≈ 568 億，每天 2000 萬只撐 7.8 年，餘量不夠，所以選 7。

---

## 方法一：對 URL 做 Hash

最直覺的做法：把 long URL 丟進 hash function，取前 7 個字元。

```text
MD5("https://example.com/very/long/path")
= "d41d8cd98f00b204e9800998ecf8427e"

取前 7 個 hex → "d41d8cd"
```

### 問題：截斷後一定撞

MD5 輸出 128-bit，取 7 個 hex 字元只有 28 bit（2.68 億種）。存到幾千萬筆就撞。用 SHA-256 也一樣，因為最後都要截斷。

如果改用 base62 取 7 個字元（3.5 兆種），collision 延後很多，但依然存在。Birthday paradox：不需要用完整個空間才撞，遠比直覺早。

Birthday paradox 的推導：一個房間幾個人會有兩人同天生日？算「所有人都不同天」的機率：

```text
第 1 個人：365/365
第 2 個人：364/365（避開 1 天）
第 3 個人：363/365（避開 2 天）
...
第 23 個人：343/365（避開 22 天）

全部不撞 = 365/365 × 364/365 × ... × 343/365 ≈ 0.493
至少撞一次 = 1 - 0.493 = 50.7%
```

23 個人，365 天的空間，就超過 50%。因為每多一個人不是多一次比對，是多「跟前面所有人比對」。23 個人有 253 組配對（k×(k-1)/2）。

套到 hash 空間：近似公式 k ≈ √N 時碰撞機率約 50%。

```text
N = 2.68 億（7 hex）  → k ≈ 16,000 筆就有 50% 碰撞
N = 3.5 兆（7 base62）→ k ≈ 187 萬筆就有 50% 碰撞
```

對 Bitly 等級的服務（每天 2000 萬筆），187 萬筆是幾小時的事。

### Collision 怎麼處理

```text
hash("https://example.com/a") = "Xk9mP2q"
hash("https://example.com/b") = "Xk9mP2q"  ← 撞了

→ 在 URL 後面加 salt，重新 hash
hash("https://example.com/b" + "1") = "Rn3vL8w"  ← 不撞了
```

Salt 就是在原始輸入後面拼一段額外字串，讓 hash 結果完全不同。Hash function 的特性：輸入差一個字元，輸出就完全改變（avalanche effect）。這裡最簡單的做法是遞增數字：撞了加 `"1"` 再算，還撞就加 `"2"`，通常一兩次就解決。

Salt 這個詞來自密碼學：存密碼時 hash(password + random_salt)，即使兩人用同一組密碼，DB 裡的 hash 也不同。短網址場景不需要隨機 salt，只需要「跟上一次不同」讓 hash 結果改變。

每次建立前都要查 DB「這個 key 存不存在」。存在的話，比對 DB 裡的 long_url 和這次送進來的是不是同一個。同一個就直接回傳（不是 collision，是重複請求）。不同才是真的撞了，加 salt 重試。最差情況可能重試好幾次。

### 一個特性

同一個 long URL 永遠算出同一個 hash。天然 dedup（natural deduplication）：不需要額外查 DB 確認「這個 URL 縮過沒」，hash 本身的特性就保證同一個輸入永遠同一個輸出。

但實務上大部分短網址服務需要**每個用戶各自產一個 key**，即使縮的是同一個 URL。因為每個人要看自己的 analytics：

```text
用戶 A 縮 https://example.com/sale → short.url/Xk9mP2q → A 看到 500 次點擊
用戶 B 縮 https://example.com/sale → short.url/Rn3vL8w → B 看到 30 次點擊
```

共用同一個 key 的話，點擊數混在一起，分不出哪些是 A 帶來的流量。Bitly 就是每個用戶各自產一個 Bitlink。這種場景下天然 dedup 反而是限制，需要在 hash 輸入加入 user_id 打破 dedup：`hash(url + user_id)`。

唯一不需要分的是純公共工具型（像早期的 TinyURL），沒有帳號、沒有 analytics，純粹縮短。但現在幾乎沒有短網址服務不做 analytics 了。

---

## 方法二：全域 Counter + Base62

Counter 就是一個遞增的號碼產生器。每次有人要縮網址，counter +1，發一個號碼。跟 hash 不同，counter 完全不看 URL 內容，純粹發號碼牌。拿到號碼後轉成 base62（用 a-z, A-Z, 0-9 共 62 個符號表示數字，跟十進位轉十六進位同一個原理），就是 short key。

```text
counter = 1            → base62 → "1"
counter = 62           → base62 → "10"
counter = 1,000,000    → base62 → "4c92"
counter = 3,521,614,606,208 → base62 → "zzzzzzz" (7 位的上限)
```

用 base62 而不是十進位：同樣 7 個字元，十進位只有 10^7 = 1000 萬種，base62 有 62^7 = 3.5 兆種。空間大得多，key 也更短。

每個數字唯一，所以不會撞。實務上 counter-based 最常被推薦，因為保證不碰撞、不用查 DB 確認。

### 問題一：可預測

知道最新的 short URL 是 `short.url/4c92`，那 `4c91`、`4c93` 都存在。攻擊者可以遍歷所有短網址，取得所有人縮過的 URL。

這不是短網址獨有的問題。大部分 API 都用 ID 存取資源（`GET /users/:id`），無法避免暴露。問題是暴露之後能被推算出什麼。

| | Auto-increment / BIGSERIAL | UUID v4 / v7 / Snowflake |
|---|---|---|
| 可列舉 | `/users/1` 到 `/users/9999` 全部試一遍 | 128-bit 空間，猜中機率趨近零 |
| 洩漏規模 | `/users/58000` → 大約 5.8 萬用戶 | 看不出總量 |
| 洩漏順序 | `id=100` 比 `id=50` 晚建立 | UUID v4 完全無序。UUIDv7/Snowflake 前面有 timestamp，但需要知道格式才能解讀 |

即使有權限檢查，auto-increment 仍然讓攻擊者知道「這個 ID 存在但我沒權限」。UUID 則連 ID 是否存在都猜不到。

### 問題二：Single Point of Failure

Counter 放在哪？一台機器上？掛了就不能產生新 URL。

用 DB 的 auto-increment？所有寫入都打同一台 DB 拿號碼。這台 DB 變成瓶頸。

### 號碼段（Range）分配

一台 counter service 統一管號碼。Application server 來領號碼段：

```text
Server A 領到 [1, 10000]        → 在這個 range 裡自己 +1
Server B 領到 [10001, 20000]    → 在這個 range 裡自己 +1
Server C 領到 [20001, 30000]    → ...
```

每台 server 在自己的 range 裡遞增，用完再領。Counter service 不需要每個 request 都打，只在 range 用完時才打。壓力小很多。

但 counter service 本身仍然是 single point of failure。掛了就沒人能領號碼。需要做 HA：把 counter 的目前值（「下一個號碼段從哪開始」）存進 etcd 或 ZooKeeper。這兩個是多節點系統，用共識協議（Raft / ZAB）保證資料一致，一台掛了其他的還能服務。counter service 重啟後從 etcd 讀回最新值繼續發號。

---

## 方法三：Snowflake-like ID + Base62

用 Snowflake 的方式產生 64-bit 整數（timestamp + machine ID + sequence），再轉 base62。

```text
Snowflake ID = 7183294852610
→ base62 → "2Tg5nQ1" (7 字元)
```

分散式（每台機器自己產，不撞），自帶時間排序。

### 問題：長度不穩定

Base62 跟十進位一樣，數字越大字元越多。64-bit 整數轉 base62，長度取決於數字大小：

```text
小的 ID：  7183294852610   → base62 → "2Tg5nQ1"     （7 字元）
大的 ID：  9999999999999999 → base62 → "FXsk4cBz7"  （9 字元）
最大 64-bit：2^63 - 1      → base62 → "aZl8N0y58M7"（11 字元）
```

Snowflake ID 裡面有 timestamp，隨時間增長 ID 越來越大，轉出來的字元數也跟著變長。Counter 從 1 開始慢慢長，前期 key 很短。Snowflake 的 timestamp 一開始就很大，所以一開始就可能超過 7 個字元。

如果硬截 7 個字元，又回到 collision 問題。可以只用 Snowflake 的 ID 空間的一部分（限制 timestamp 範圍），確保不超過 7 個字元。但要算清楚可用年限。

---

## 301 vs 302

用戶點了短網址，server 要把他導向原始的長 URL。這個「導向」透過 HTTP redirect 完成：server 回一個 3xx status code，告訴瀏覽器「去這個 URL」。

```text
用戶瀏覽器 → GET short.url/Xk9mP2q
Server     ← 302 Found, Location: https://example.com/very/long/path
用戶瀏覽器 → GET https://example.com/very/long/path（自動跳轉）
```

301 和 302 都是 redirect，差別在瀏覽器會不會記住：

```text
301 Moved Permanently → 瀏覽器記住了，下次點同一個短網址不問 server，自己直接跳
302 Found             → 瀏覽器不記，每次都問 server
```

301 省 server 負擔。但 server 看不到後續的點擊，click analytics 斷了。

302 每次都經過 server。可以記錄每一次點擊。多消耗一次 round trip，但對短網址服務來說，知道每一次點擊比省流量重要。

大部分短網址服務用 302。

---

## 三個方法的比較

| | Hash 截斷 | Counter + Base62 | Snowflake + Base62 |
|---|---|---|---|
| 碰撞 | 截斷後會撞 | 不撞 | 不截就不撞 |
| 可預測 | 否 | 是（連續遞增） | 部分（timestamp 可推） |
| 分散式 | 天生分散 | 需要 counter service | 天生分散 |
| Key 長度 | 固定 | 隨 counter 增長 | 隨 ID 增長 |
| Dedup | 天然（同 URL 同 hash） | 無 | 無 |

選哪個其次，講得出**為什麼選、放棄了什麼、放棄的部分怎麼補**，才是面試官要聽的。

---

## 常見追問

以下幾個常見的延伸問題，先自己想，再看提示。

---

> **「同一個 long URL 送進來兩次，應該回傳同一個 short key 嗎？」**
>
> 這是 business decision，不是技術問題。要先確認短網址是不是 user 自己管的資產。
>
> 如果不同 user 縮同一個 URL 共用同一個 key，點擊數混在一起，分不出哪些流量是誰帶來的。Bitly 就是每個 user 各自產一個 Bitlink，即使目標 URL 相同。這是主流做法，因為幾乎所有短網址服務都提供 per-user analytics。
>
> 唯一回傳同一個 key 的場景：純公共工具型（沒有帳號、沒有 analytics），省空間。但現在幾乎不存在了。
>
> 先確認「需不需要 per-user tracking」，這個答案會影響 key 生成策略和整個儲存設計。

---

> **「Counter 的 key 可以被遍歷。怎麼防？」**
>
> Counter 產出的 key 是連續的：`4c91`、`4c92`、`4c93`。知道一個就能猜出前後所有的。防法：counter 產出的數字是內部 ID，不直接當 short key。中間加一層轉換，讓外部看到的 key 不可預測。
>
> ```text
> 內部 ID（可預測）     →  轉換  →  外部 key（不可預測）
> counter = 1000001    →         → "Rn3vL8w"
> counter = 1000002    →         → "Xk9mP2q"
> counter = 1000003    →         → "Qp7kN4x"
> ```
>
> 兩種做法都是 bijective function（雙射函數）：每個輸入對應唯一一個輸出，每個輸出也只對應一個輸入。不會有兩個 ID 轉成同一個 key（不碰撞），也可以從 key 反推回 ID（可逆）。
>
> ```text
> bijective：       1→a  2→b  3→c    不撞，可逆
> non-bijective：   1→a  2→a  3→c    撞了，1 和 2 都變成 a
> ```
>
> **簡單版：bit shuffling。** 把 ID 的二進位位元按照一個固定規則重新排列。像撲克牌洗牌，每次用同一個順序洗，所以同一個輸入永遠得到同一個輸出。
>
> ```text
> ID = 5 的二進位：           0 1 0 1
> 規則：把第 1 位和第 4 位交換
> 結果：                      1 1 0 0 = 12
>
> ID = 6 的二進位：           0 1 1 0
> 同樣規則：                  0 1 1 0 = 6（碰巧沒變）
> ```
>
> 外部看到的數字不連續，但知道洗牌規則就能反推。不是加密，只是打散。
>
> **安全版：AES 加密。** Server 持有一把 secret key（128-bit 隨機字串），用 AES 加密 counter ID，得到一個看起來完全隨機的數字，再轉 base62。
>
> ```text
> AES(secret_key, 1000001) = 82719364 → base62 → "Rn3vL8w"
> AES(secret_key, 1000002) = 50183927 → base62 → "Xk9mP2q"
> AES_decrypt(secret_key, 82719364) = 1000001 ← 可以反推
> ```
>
> 攻擊者看到 `Rn3vL8w` 和 `Xk9mP2q`，沒有 secret key 無法推出下一個是什麼，也無法知道這兩個是連續 ID。跟 bit shuffling 的差別：洗牌規則被猜到就能破解，AES 的 128-bit key 暴力破解不可行。
>
> Counter 保證不撞（內部），轉換保證不可預測（外部）。兩個問題分開解決。

---

> **「Counter service 掛了，正在用的 server 還能不能繼續產 key？」**
>
> 可以。因為 range 機制，每台 server 之前已經領了一段號碼（例如 `[30001, 40000]`），counter service 掛了，手上還有沒用完的號碼，繼續發就好。
>
> ```text
> Counter service 只做一件事：
>   有人來領 → 把 next_start 給他 → next_start += 10000
>
> next_start 只有一份，存在 counter service（背後是 etcd/ZooKeeper），所有 server 共用。
> 領 range 要是原子操作（compare-and-swap），兩台同時來只有一個成功，另一個重試。
> ```
>
> 邊界情況：
> - **Range 用完了？** 領不到新 range，回 503 告訴 client 稍後再試（graceful degradation）。Redirect（讀取）照常運作，只有建立新短網址暫停。
> - **Gap？** Server A 領了 `[30001, 40000]` 但只用到 35000 就重啟，35001-40000 永遠不會被用。Counter service 恢復後從 next_start 繼續發，中間有 gap。但 gap 只是浪費號碼，3.5 兆種組合浪費幾千個無所謂。
> - **恢復後怎麼繼續？** next_start 存在 etcd/ZooKeeper 裡，重啟後讀回來就知道從哪發。

---

> **「hash 方法需要每次都查 DB 確認不碰撞。一秒一萬個建立請求，DB 撐得住嗎？」**
>
> 用 Bloom filter 擋在 DB 前面（詳見 [bloom-filter](chunk://bloom-filter) chunk）。先問 Bloom filter，「一定不存在」就直接用，不查 DB。大部分新 key 都不會撞，只有極少數 false positive 才真的打到 DB。10,000 QPS 可能只有幾十個落到 DB。
>
> Bloom filter 活在 RAM 裡，查一次幾十奈秒。DB 查詢要走 SSD + 網路，慢 10,000 倍以上。系統啟動時從 DB 載入所有已存在的 key 到 Bloom filter，之後每次新增也同步加入。用 RedisBloom 的話可以跟著 Redis 一起持久化，重啟不用重建。

---

> **「custom alias（用戶自訂 short key，例如 `short.url/my-brand`）跟系統自動產生的 key 怎麼共存？」**
>
> 從源頭讓兩邊的 key 格式不重疊，碰撞就不可能發生：
>
> ```text
> 系統產的：純 base62（"Xk9mP2q"）
> 用戶自訂：必須包含 hyphen（"my-brand"）或長度不同
> → 格式不同，不可能撞
> ```
>
> 用戶申請 custom alias 時查 DB，已被佔就拒絕（「已被使用，請換一個」）。跟搶 username 一樣，用戶能接受這個體驗。
>
> 如果被追問「已經上線了才加 custom alias 功能」：舊 key 不動，新的 custom alias 撞到舊 key 就拒絕，未來系統產的 key 改成不會跟 custom 格式撞的格式。先回答乾淨的設計，被追問再講 migration。

---

> **「如果同一個 long URL 用同一個 idempotency key 送了兩次，第二次應該回傳什麼？」**
>
> 看 server 的處理狀態（詳見 [idempotency](chunk://idempotency) chunk）：
>
> ```text
> 已處理完：查到 idempotency key 的結果已存好
>   → 直接回傳上次的結果（201 + "Xk9mP2q"），不再建立新的
>   → 對 client 來說，response 跟第一次一模一樣
>
> 正在處理中：同一個 key 正在執行，還沒完成
>   → 回 409 Conflict（請求跟目前狀態衝突），告訴 client 稍後再試
>   → 不用 429（429 是 rate limiter 擋太頻繁，語義不同）
> ```

---

## 沒有 X 怎麼辦

有時候要在拿掉某個常見工具的限制下，用更原始的方式解決。

---

> **「不能用 ZooKeeper / etcd 管 counter，怎麼分配號碼段？」**
>
> 用 DB 本身當 counter service。DB 裡一張表存 `next_start`，領 range 就是一次 `UPDATE`：
>
> ```sql
> UPDATE counter_table
> SET next_start = next_start + 10000
> RETURNING next_start;
> -- 拿到 30001，next_start 變 40001
> ```
>
> DB 的 `UPDATE ... RETURNING` 本身就是原子操作（ACID 的 A），不需要額外的 compare-and-swap。
>
> ZooKeeper / etcd 的價值是多副本高可用。但 DB 本身也有 replication（leader-follower），用 Aurora 的話更不用擔心：3 個 AZ 各存 2 份共 6 份，writer 掛了自動 failover（~30 秒），read replica 直接 promote，不需要選舉也不需要複製資料。任何有 ACID + 高可用的儲存都能當 counter service，DB 是最現成的選擇。

---

> **「不能用 Bloom filter，怎麼快速確認 key 不重複？」**
>
> 回頭問「為什麼需要 dedup」。如果用 counter 方案，每個號碼唯一，天生不重複，根本不需要 dedup 機制。選對生成策略，問題本身就消失了。

---

> **「不能用任何 external service（Redis、ZooKeeper、counter service 都不行），多台 server 怎麼產不重複的 key？」**
>
> 每台機器本身就是一個獨立的隔離空間。用 machine ID 當 prefix，每台 server 在本地遞增，不需要任何 external service 協調。
>
> ```text
> Server A（machine_id = 01）：01-00001, 01-00002, 01-00003
> Server B（machine_id = 02）：02-00001, 02-00002, 02-00003
> Server C（machine_id = 03）：03-00001, 03-00002, 03-00003
> ```
>
> Prefix 不同所以不可能撞。就是 Snowflake 的核心原理（timestamp + machine ID + sequence），不需要 Snowflake library 也能自己實作。

---

## 這篇到這裡

Key 生成只是開始。下一個問題：這些 key-value pair（short key → long URL）在量大之後存在哪裡？

---

## References

- [Bitly：每月超過 100 億次連結點擊／掃描（官方 press release）](https://bitly.com/pages/resources/press/bitly-wraps-2022-surpassing-100m-in-arr-and-over-500k-global-customers/)
