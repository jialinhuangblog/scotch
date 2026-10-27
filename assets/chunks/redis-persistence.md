---
title: "Redis Persistence"
slug: redis-persistence
brief: "Redis 在 RAM 操作，靠 RDB 快照或 AOF append log 寫到磁碟；AOF 預設每秒 fsync，最多丟一秒。"
date: 2026-07-20
updated: 2026-10-18
revisions: 3
---

# Redis Persistence

持久化（persistence）指資料在程式或機器重啟後還在。RAM 裡的資料斷電就沒了，SSD 上的資料斷電還在。Redis 平時全部在 RAM 裡操作，速度就是這樣來的，代價是重啟即歸零，所以要另外把資料寫到磁碟。

拿一個按讚計數器走一遍。key 是 `likes:post:42`，每秒大約 1000 次 `INCR`。機器在 10:00:30 斷電。

**RDB** 是定期把整個 RAM 快照寫成一個檔。假設設定每 5 分鐘一次，上一次快照是 10:00:00，那 10:00:00 到 10:00:30 這 30 秒的三萬次 INCR 全部不見，重啟後計數器回到 10:00:00 當時的值。快照本身是 fork 出一個子程序去寫，主程序繼續服務，但寫入頻繁時 copy-on-write 會讓記憶體用量暫時變多。

**AOF** 是每一條會改資料的指令都 append 到一個檔案的最後面，跟資料庫的 [WAL](chunk://wal) 同一個做法。預設 `appendfsync everysec`，每秒 fsync 一次，所以同樣在 10:00:30 斷電，丟的只有最後那一秒還沒 fsync 的大約 1000 次。重啟時 Redis 要把 AOF 裡的指令重播一遍才開始服務，三萬條 INCR 大約 1MB，就照樣一條一條重播。不過檔案不會一直長下去。預設 AOF 超過 64MB、而且比上次 rewrite 之後大了一倍，Redis 就在背景 rewrite，把累積的 INCR 換成一筆直接寫入 `likes:post:42` 現值的紀錄。一條 INCR 在 AOF 裡大約 34 bytes，這個計數器累積到大約兩百萬條時就會 rewrite 一次。在本機用 Redis 7.2 的預設值連送三百萬次 INCR，中間 rewrite 了一次，重啟時要重播的只剩大約一百萬條。重播指令比直接載入快照慢，所以 AOF 還原還是比 RDB 慢。

| | RDB | AOF |
|---|---|---|
| 做法 | 定期把整個 RAM 快照寫成一個檔 | 每筆寫入指令 append 到檔案 |
| 檔案 | 小，還原快 | 比 RDB 大，還原要重播上次 rewrite 之後的指令 |
| 會丟多少 | 上次快照之後的全部 | 預設最多丟 1 秒 |
| 成本 | fork 做快照，記憶體暫時變多 | 每個命令都 write() 進 AOF，每秒一次 fsync |

實務常見兩個一起開，`dump.rdb` 拿來備份、搬到別台機器，AOF 負責讓斷電最多只丟一秒。兩個都開的時候，重啟只讀 AOF，Redis 不會去讀 `dump.rdb`。AOF 的還原沒有想像中慢，是因為 Redis 7 的 AOF 本身也帶一份快照：它是一個目錄，裡面一個 base 檔加一個 incr 檔，base 是上次 rewrite 時寫下的完整資料，預設用 RDB 格式，incr 是 rewrite 之後的指令。重啟時先載入 base，再重播 incr。這個 base 檔跟 `save` 設定定期產出的 `dump.rdb` 是兩份不同的檔案，刪掉 AOF 目錄，Redis 不會改從 `dump.rdb` 接回來。

當 cache 用的話，丟 30 秒也沒差，重新從 DB 載入就好。拿 Redis 當主要儲存，像這個計數器或是佇列，就要開 AOF，連那一秒都不能丟的話改成 `appendfsync always`，每筆都 fsync，每次 INCR 都要等磁碟，明顯變慢。
