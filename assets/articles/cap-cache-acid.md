---
title: "CAP、cache 策略跟 ACID，是什麼關係"
slug: cap-cache-acid
date: 2026-10-17
subtitle: "Read-Through 是 Redis 自己查 DB 嗎？RDB 一定是 CP 嗎？CAP 跟 ACID 要挑一個嗎？這幾個問題各自屬於哪一層。"
chapter: "storage"
tags: [cap, cache-strategies, acid, pacelc, replication]
related: [replication-cap, cache-hot-key]
---

CAP、cache 策略、ACID 這三個東西常被放在一起講，有時候還會畫成同一張圖：Write-Through 跟 Write-Around 放在 CAP 三角形的 C 角，Write-Behind 放在 A 角，Cache-Aside 跟 Read-Through 擺在中間。看起來很整齊，可是一追問，就有好幾個地方對不上。

## 問：Read-Through 就是 Redis 自己去查 DB 嗎

答：不是，一般在用的 Redis 本身不會去查 DB。沒裝 module 的 Redis 不認識旁邊那台 Postgres，它沒有連線設定，也沒有 schema，收到 GET 沒有值就回 nil，就這樣。

那 Read-Through 說的「cache 自己去查」，到底是誰在查呢？先看 Cache-Aside 長什麼樣子：

```python
# Cache-Aside：miss 的處理寫在 business code 裡
def get_user(id):
    v = redis.get(f"user:{id}")
    if v is None:
        v = db.query("SELECT * FROM users WHERE id = %s", id)   # app 自己查 DB
        redis.set(f"user:{id}", v, ex=1800)
    return v
```

app 手上同時有 Redis 跟 DB 兩條連線，miss 了自己查、自己回填。Read-Through 是把同樣這段邏輯搬進一個 cache 類別，business code 只跟這個類別講話：

```python
# Read-Through：同一段邏輯搬進 cache 這一層
class ReadThroughCache:
    def __init__(self, redis, loader):
        self.redis = redis
        self.loader = loader               # 「怎麼查 DB」只交代一次

    def get(self, key):
        v = self.redis.get(key)
        if v is None:
            v = self.loader(key)           # miss 時由這一層去查 DB
            self.redis.set(key, v, ex=1800)
        return v

users = ReadThroughCache(redis, loader=lambda k: db.query("SELECT ...", k))

def get_user(id):
    return users.get(f"user:{id}")         # business code 裡沒有 DB 了
```

兩段裡面的 Redis 完全一樣。差別只在查 DB 那一行，從 `get_user` 搬進了 `ReadThroughCache`。所以 Read-Through 講的「cache」，指的是 Redis 前面多出來的這一層，不是 Redis server 本身。Spring Cache、Caffeine 的 LoadingCache、Hibernate 二級快取，都是把「miss 時去查 DB」這一層做成 library，差別只在資料存在哪裡，像 Caffeine 就直接存在 app 自己的記憶體，不一定接 Redis。這一層甚至可以跑進 Redis 裡面：RedisGears 有現成的範例，rgsync 把 Redis 的寫入同步到 MySQL，rghibernate 還能做 read-through。只是那已經是裝了 module 的 Redis，不是一般拿來當 key-value 用的那種。

這一層也可以獨立成一個服務。DynamoDB 前面的 DAX 就是這樣，app 只認得 DAX 的 endpoint，連 DynamoDB 的 client 都不用建，miss 的時候由 DAX 自己去 DynamoDB 拿。app 分不出這次是 hit 還是 miss，頂多覺得這次比較慢。拿餐廳來比的話，Cache-Aside 像是自己先翻冰箱，沒有再跑一趟超市；Read-Through 則是只跟櫃台點餐，櫃台沒貨就自己去補，客人不會知道。

寫入也是同一個分法：

```text
Write-Through  app 寫 cache → cache 同步寫 DB → 兩邊都成功才 ack
Write-Behind   app 寫 cache → 馬上 ack → cache 稍後批次寫回 DB
Write-Around   app 直接寫 DB、跳過 cache（有舊值就刪）→ 下次讀 miss 再回填
```

Write-Through 跟 Write-Behind 都是 cache 這一層收下寫入，再由它去寫 DB，所以也需要那一層。Write-Around 是 app 自己寫 DB，Cache-Aside 寫入時通常也是「先寫 DB，再刪 cache key」，等於 Write-Around 多刪一個 key。整理起來，五種策略看的其實是 DB 連線握在誰手上：

```text
cache 這一層握有 DB 連線（inline）    Read-Through、Write-Through、Write-Behind
app 自己握 DB 連線（aside）          Cache-Aside、Write-Around
```

這也是為什麼 Read-Through 常常跟 Write-Through 一起出現，像 DAX 就兩個都是：既然已經有一層會連 DB，讀寫自然都交給它。Cache-Aside 則多半配「寫 DB 再刪 key」，Redis 加 MySQL 幾乎都這樣用。五種各自的 60 秒版本在 [Cache Strategies](chunk://cache-strategies)。

## 問：那 cache 策略可以放進 CAP 三角形嗎

答：放不太進去。CAP 的三個字母，是拿來描述好幾個 replica 在網路斷掉的時候會怎麼反應。cache 策略要決定的，卻是 cache 跟 DB 這兩份副本什麼時候同步，兩邊問的不是同一件事。

不過它們也不是完全沒關係。把 ACID 也放進來的話，三個東西剛好各在一層，差別在資料有幾份：

```text
一台 DB 內，WAL ↔ data page   ACID 的 D       commit 時 WAL 先落盤，data page 稍後才寫
cache ↔ DB，兩份副本          cache 策略      同步 / 非同步 / 誰去撈
replica ↔ replica，多份       CAP、PACELC     分區時 C 或 A，平常 L 或 C
```

最上面那層也有兩份。commit 的時候，DB 只等 WAL 寫進磁碟就回 ack，真正的 data page 晚一點才寫，中間要是掛了，重開時再從 WAL 補回來。所以三層問的其實是同一件事：資料有兩份以上的時候，ack 之前等了哪幾份，掛掉之後接手的又是哪一份。接手的那份有被等過，資料就不會掉；沒被等過，就可能掉。WAL 那列是前者，DB 只等 WAL，掛掉重開也是從同一份 WAL 補回來。Write-Behind 是後者，它只等 cache 那份，可是那份在記憶體裡，掛掉就沒了，接手的是沒被等過的 DB。CAP 跟 cache 策略真正交會的地方，就是下面這兩列：

```text
同步     Write-Through  ≈  同步複寫（Postgres remote_apply）   慢、ack 時兩份都已更新
非同步   Write-Behind   ≈  非同步複寫（async replica）          快、有一段舊值、中間掛掉會掉資料
```

同步那列兩份都等過，誰接手都不會掉。非同步那列會跟 Write-Behind 放在一起，是因為兩邊接手的都是沒被等過的那份。非同步複寫的 primary 只等自己的 WAL，primary 掛掉後換 replica 接手，replica 沒被等過。Write-Behind 則是 cache 掛掉後換 DB 接手。

Write-Through 在 ack 的時候，cache 跟 DB 都已經是新值，代價是每次寫入都要等兩邊寫完。不過這只保證到 ack 那一刻：要是 cache 寫成功、DB 寫失敗，這筆不會 ack，cache 卻已經先變了，ACID 那一節還會再講到；兩個人同時改同一個 key 的話，cache 跟 DB 的寫入順序也可能不一樣。Postgres 那邊同樣要挑設定，`synchronous_commit` 設 `on` 只保證 standby 把紀錄寫進磁碟，standby 上的查詢不一定馬上讀得到，要設 `remote_apply` 才會等 standby 套用完再回。Write-Behind 寫很快，還能把一百次 +1 合成一次寫，可是 cache 要是在寫回之前就掛了，那些 +1 也就跟著沒了，所以讚數、瀏覽數這種東西才適合它。

所以把 Write-Through 放在 C 那邊、Write-Behind 放在 A 那邊，方向倒是沒錯，只是它們對應的是 PACELC 的 ELC，也就是平常沒分區的時候，要在 Latency 跟 Consistency 之間選一個。CAP 的 P 那半邊，在 cache 裡只有一個勉強對得上的情況：cache 跟 DB 之間斷線了，Write-Through 的寫入會失敗，算是偏 C；Write-Behind 照收不誤，算是偏 A。

剩下三個策略就放不進去了。開頭那張圖把 Write-Around 也擺在 C 角，理由大概是「它直接寫 DB，所以最一致」。可是它跳過 cache，舊的 key 沒刪的話，cache 就一直是舊值，讀起來反而是五個裡面最不一致的。Cache-Aside 跟 Read-Through 講的是 miss 誰去撈，跟一致性、可用性都扯不上。要是一堆 miss 同時打到 DB 上，那又是另一個問題了，寫在[cache 沒事，直到大家同一秒要同一個 key](article://cache-hot-key)。

## 問：RDB 是 CP、NoSQL 是 AP 嗎

答：一半不成立，一半大致對，但原因跟 SQL 沒關係。NoSQL 裡面 CP、AP 都有，所以「NoSQL 是 AP」不成立。RDB 幾乎不會是 AP，可是也不一定是 CP：Postgres 開同步複寫、讀寫都只走 primary 的話是 CP，允許讀 standby 的話就 CP、AP 都放不進去。決定落在哪裡的是複寫怎麼設計，也就是上面那張圖最下面那一層。

先想一個最小的情況吧。兩台 replica，中間的網路斷了，這時候有個 client 對其中一台寫入。

- 選 C 的話，就拒絕這筆寫入，或者只讓連得到多數的那一邊收。這樣任何時候讀到的都是同一版，代價是大概有一半的節點只能回 error。
- 選 A 的話，兩邊都照收，各自繼續服務，等網路恢復再來合併。代價就是斷線那段時間，兩邊讀到的值不一樣。

其實還有第三種情況，而且很常見。很多系統的兩台 replica 並不對等，只有一台是 leader，寫入都要經過它；另一台是 follower，從 leader 複製資料，手上也有一份完整的副本。網路斷掉的時候，兩台機器都還活著，只是中間的線斷了。

假設 10:00:00 網路斷了。10:00:05 有人在 leader 那邊把餘額從 100 改成 80，這筆傳不到 follower。10:00:10 有個 client 只連得到 follower，follower 這邊就是連不到多數的「少數那一邊」：

- 寫入：follower 知道自己不是 leader，拒絕這筆寫入，所以不是 A。
- 讀取：follower 照自己那份回 100，可是正確的值已經是 80 了，所以也不是 C。

寫入拒絕、讀取又回舊值的情況，CP、AP 都放不進去，所以下面的表格另外列了一列。etcd、ZooKeeper、MongoDB、DynamoDB、Postgres 雖然是不同的系統，複寫都是這種一個 leader 加幾台 follower 的做法。斷線之後，少數那邊的 follower 要是還照自己的副本回讀取，就落在這一列；要是讀取也停下來，或是能保證回的還是最新值，就是 CP。

[CAP](chunk://cap) 講的是多節點的系統，單機的 Postgres 根本沒有第二個節點可以斷，所以不在範圍裡。等到有了 replica，選 C 還是 A 就是[複寫](chunk://replication)的設定問題了。

那 NoSQL 為什麼常被當成 AP 呢？大概要回到它們當初是做給誰用的。Dynamo 那篇論文的客戶是購物車，使用者按下「加入購物車」，不管怎樣都要成功，就算兩個資料中心斷線也一樣，所以它選了 A，衝突留到事後再合併。ZooKeeper 剛好相反，它的客戶是 lock 跟設定檔，兩個節點要是對「誰拿到 lock」給出不同答案，那就出事了，所以搶 lock 這種寫入要多數派同意，少數那一邊寧可寫不進去。不過 ZooKeeper 平常的讀取倒是不保證最新。client 讀的是自己連上的那台，那台可能還沒收到 leader 剛寫進去的東西，官方文件也直接寫了讀取不是 linearizable，意思就是不保證讀到最新的寫入。可是一旦斷線，跟多數派斷開的那台 server 就不再回應 client，連讀取也停了，所以分區時它還是 CP。官方文件說另外開 read-only mode 的話，那台 server 會讓要求唯讀的 client 連上。在本機用 3.8.4 測過，只開 read-only mode 還不夠，client 一連上就被斷開；三台都再加上 `localSessionsEnabled=true` 跟 `localSessionsUpgradingEnabled=true` 之後，斷開的那台照自己的副本回了舊值，寫入則回「Not a read-only call」。所以這樣設定的 ZooKeeper，就落在 CP、AP 都放不進去的那一列。

不過 Dynamo 跟後來 AWS 的 DynamoDB 是兩套系統。DynamoDB 2022 年的論文自己說，它沿用了 Dynamo 大部分的名字，架構卻沒留下多少。DynamoDB 把資料切成很多份，每一份叫一個 partition。這是資料的切分，跟網路斷線的「分區」是兩回事。每個 partition 有自己的一組 replica，用 Multi-Paxos 這種共識演算法選出一個 leader，寫入只走 leader，也就是上面那種一個 leader 加幾台 follower 的做法。

所以單一 region 的 DynamoDB 遇到網路斷線，跟上面那個餘額的例子一樣，follower 那邊寫不進去。讀取則有兩種讀法可以選。選 strongly consistent read 的話，讀取也只走 leader，follower 那邊讀不到，這是 CP。選 eventually consistent read 的話，follower 照自己的副本回，可能是舊值，就落在 CP、AP 都放不進去的那一列。平常沒斷線的時候，eventually consistent read 的好處是快，因為任何一台都能回。

真的會兩邊都收寫入的，是跨 region 的 global tables。預設的 MREC 模式每個 region 都能寫，同一筆在兩邊同時被改，就留時間比較晚的那一筆，這叫 last writer wins，這才是 AP。另一種 MRSC 模式，寫入要同步到另一個 region 才回，又回到 CP。

下面這張表裡的每個系統，都是照同一個問題分類的，也就是網路斷線時，少數那一邊的寫入跟讀取各自怎麼處理。同一個系統換了讀法或寫法，答案就會不一樣，所以括號裡寫的是設定。

| 分區時 | NoSQL | RDB |
|---|---|---|
| CP：少數那邊不收寫入，讀到的一定是最新值，給不出最新值就不回 | etcd（預設讀取）、ZooKeeper（預設）、MongoDB（readPreference primary）、DynamoDB（strongly consistent read；global tables 要選 MRSC） | Postgres（同步複寫，讀寫都只走 primary）、CockroachDB |
| 兩邊都不是：少數那邊拒絕寫入，讀取照回，但可能是舊值 | etcd（serializable read）、ZooKeeper（開 read-only mode 加 local session）、MongoDB（readPreference secondary）、DynamoDB（eventually consistent read） | Postgres（允許讀 standby，同步或非同步都一樣） |
| AP：兩邊都收寫入 | Cassandra（寫入用 ONE，一台 replica 回應就算成功）、DynamoDB global tables（MREC） | 少見，原因見下文 |

括號裡的讀法，差別都在讀 leader 還是讀 follower。拿連鎖鞋店來比：庫存的正本在總部，分店只有一張早上從總部印回來的庫存表。客人問分店有沒有貨，店員可以打電話問總部，答案一定是最新的，但要多等一通電話，電話接不上就答不出來；也可以直接看那張表，答得快，電話斷了也照樣能答，可是總部十分鐘前可能已經賣完了。etcd 預設的讀取（linearizable read）是打電話那種，serializable read 是看表那種。在本機起三台 etcd、停掉其中兩台之後測過，剩下那台對 serializable read 照樣回了停機前的值，預設讀取跟寫入都等到逾時失敗。MongoDB 的 primary 跟 secondary 就是總部跟分店。ZooKeeper 平常讀的也是連上的那台，只是斷線之後預設不再回應。

RDB 那一欄的 AP 幾乎是空的，用 Postgres 講就知道為什麼。同步複寫的 Postgres 遇到斷線，primary 等不到 standby 回應，寫入就一直卡著不回，等於不收寫入。這時要是讀寫都只走 primary，standby 那邊的 client 什麼都拿不到，這是 CP。可是 standby 也能開成 hot standby 接唯讀查詢，斷線後它照樣回，官方文件對 `remote_apply` 的保證也只寫到 causal consistency，設成 `on` 連這個都沒提，不保證每次讀到的都是最新值，那就跟上面餘額的例子一樣，CP、AP 都放不進去。`synchronous_commit` 設 `on` 還是 `remote_apply`，在斷線時沒有差別；前面講過，兩者的差別在平常讀 standby 的時候，`remote_apply` 等 standby 套用完才回，剛寫完馬上去 standby 讀也讀得到新值。

改成非同步複寫的話，直覺會以為它變成 AP，其實也不是。像 Patroni 這類自動 failover 工具，primary 一旦更新不了 etcd 之類協調服務裡的 leader lock，就會立刻降級成唯讀，所以分區的時候只有一邊在收寫入，並不是「兩邊都照收」。它真正放掉的是另一件事：primary 掛掉、replica 升上來的時候，primary 上最後幾筆還沒複寫過去的寫入就沒了，client 明明收到過「寫入成功」。這比較像丟了 durability，CP、AP 兩邊都放不進去。

真正從設計上就站在 CP 的 RDB 也有，像 CockroachDB。它的寫入要多數 replica 同意，斷線後少數那邊收不了寫入；少數那邊握有 lease 的那台，只能在 lease 到期前回讀取，這段時間別人也拿不到 lease、寫不進新資料，所以讀到的還是最新值。它的官方部落格就自稱 CP。

那 RDB 為什麼很少落在 AP 呢？大概是因為它要的那些東西：唯一鍵、外鍵、transaction，都要求所有寫入排成同一個順序。假設分區的時候兩邊都照收，兩邊可能各自註冊了一個同樣 email 的使用者，網路恢復後要合併，唯一鍵那條規則就保不住了。所以 RDB 的複寫多半只讓一個節點收寫入，這是需求推出來的，不是 SQL 推出來的。

而且大部分系統都可以調。Cassandra 寫入用 ONE 是 AP，讀寫都改成 QUORUM，也就是要多數 replica 回應才算數的話，官方文件寫的是寫入一定會被讀到，偏向 C，代價是分區時少數那一邊也寫不進去了；MongoDB 的 `readPreference` 從 primary 換成 secondary，就從 CP 變成兩邊都不是；DynamoDB 則是建 global table 的時候選 MREC 還是 MRSC，每次讀也能選要不要 strongly consistent。三種複寫架構各自給什麼樣的一致性，[資料複製了，然後一致性呢](article://replication-cap)那篇有比較完整的整理。

## 問：CAP 跟 ACID 要挑一個嗎

答：不用，它們在那張圖的最上面跟最下面，是不同層的東西。[ACID](chunk://acid) 是一台 DB 裡面，一筆 transaction 的保證。CAP 則是有好幾個 replica、網路又斷掉的時候，才需要做的取捨。前面那套同步複寫、讀寫都只走 primary 的 Postgres 就兩個都有：每筆 transaction 照樣有 ACID，分區的時候選 C。

另外，兩邊的 C 也不是同一個意思。ACID 的 C 是「transaction 做完之後，資料還符合自己定的規則」，像餘額不能是負的、外鍵要存在。CAP 的 C 則是「每個 replica 讀到的都是同一個最新值」。

那中間那層的 cache 策略，會不會碰到 ACID 呢？一般是碰不太到的，真的會碰到的大概只有兩個地方：

- Write-Behind 放掉的是 ACID 的 D。ack 那一刻，資料還只在 cache 的記憶體裡，還沒落到 DB。[Redis persistence](chunk://redis-persistence) 開 AOF 可以補回一部分，不過 fsync 要多久做一次，又是另一個取捨了。
- cache 跟 DB 沒辦法放進同一個 transaction。Write-Through 寫完 cache，結果 DB 寫失敗，這時 cache 已經是新值了。常見的處理是先寫 DB 再動 cache，或是用刪 key 取代更新；要做到真的可靠，就是 [outbox](chunk://outbox-pattern) 那一套。

要是真的想拿一個詞跟 ACID 並列比較，該找的是 BASE（Basically Available、Soft state、Eventually consistent），不是 CAP。這個詞最早出現在 1997 年 SOSP 一篇講叢集網路服務的論文，拿來跟 ACID 對照；2008 年 ACM Queue 那篇〈BASE: An ACID Alternative〉再把它推廣開來，當成 ACID 以外的另一種做法；名字也剛好是化學裡跟酸相對的鹼。它描述的是 AP 系統的行為：分區時照樣回應，資料暫時不一致，過一陣子才收斂成同一份。

## 問：所以實務上怎麼選

答：假設是一個 SaaS 後台好了，Postgres 加 Redis，寫入佔七成。裝置每 5 秒回報一次，每次回報寫兩個地方：在 events 表多插一列，再更新那台裝置的最新狀態，像是最後上線時間、今天回報了幾次。儀表板每 10 秒讀一次所有裝置的最新狀態。另外還有使用者設定，讀多寫少。

一開始多半會全部用 Cache-Aside：讀先查 Redis，寫進 DB 之後把 key 刪掉。跑了一陣子，Redis 的命中率卻很低。問題出在裝置狀態那批 key，它們同時被讀也被寫。裝置每 5 秒刪一次 key，儀表板每 10 秒才來讀一次，每次來讀之前 key 都已經被刪過了，所以幾乎每次都 miss，又回頭去查 DB。events 那張表反而沒影響，新插的那一列本來就不在 cache 裡，也只有報表會讀。

所以第二步，就是把資料分開處理。events 改成 Write-Around，直接寫進 Postgres，不經過 Redis。使用者設定讀多寫少，繼續用 Cache-Aside 就好。裝置狀態改成 Write-Behind：回報直接覆寫 Redis 裡的最後上線時間，次數則用 INCR 累加在一個「還沒 flush 的差量」上。每分鐘 flush 一次，用 GETDEL 把差量拿出來、同時清掉，加到 Postgres 那一列上，最後上線時間直接覆寫回去。儀表板顯示的次數，是 Postgres 裡的值加上 Redis 裡的差量。

flush 只寫差量，是為了 Redis 重啟的那一刻。要是每分鐘把 Redis 裡的總數整個寫回 Postgres，Redis 重啟後 INCR 會從 1 開始算，下一次 flush 就拿 1 蓋掉 Postgres 裡一整天的累計。

到了第三步，Write-Behind 的代價就出現了。某次 Redis 重啟，還沒 flush 的那一分鐘差量全沒了，所以今天的次數少算了最多一分鐘的回報。最後上線時間倒是沒什麼損失，5 秒後下一次回報就補回來了。後來開了 AOF，fsync 設成 everysec，Redis 文件的說法是大約會丟一秒的資料，團隊覺得可以接受，因為這些數字是給儀表板看的，又不是拿來計費。要是這個數字拿去計費的話，Write-Behind 就不能用了，得回去直接寫 DB，或者把每次 +1 改成 append 一筆事件，事後再加總。

那什麼時候該重新考慮呢？大概是 flush 的間隔為了省 DB 寫入越拉越長，而且某天有人拿這個數字做了一個不能錯的決定。到那時候，這個數字需要的就是 ACID 的 D 了，ack 之前就要落到磁碟，而這是 Write-Behind 做不到的。
