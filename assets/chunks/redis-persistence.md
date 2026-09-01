---
title: "Redis Persistence"
slug: redis-persistence
brief: "Redis 在 RAM 操作，靠 RDB 快照或 AOF append log 落盤；AOF 預設每秒 fsync，最多丟一秒。"
date: 2026-07-20
---

# Redis Persistence

持久化（persistence）：資料在程式或機器重啟後還在。RAM 裡的資料斷電就沒了，SSD 上的資料斷電還在。Redis 平時全部在 RAM 裡操作，速度就是這樣來的，代價是重啟即歸零，所以要另外把資料備份到磁碟。

兩種機制：

| | RDB | AOF |
|---|---|---|
| 做法 | 定期把整個 RAM 快照寫成一個檔 | 每筆寫入指令 append 到檔案（類似 [WAL](chunk://wal)） |
| 檔案 | 小，還原快 | 大，還原要重播全部指令 |
| 會丟多少 | 上次快照之後的全部 | 預設每秒 fsync（`appendfsync everysec`），最多丟 1 秒 |
| 成本 | fork 出子程序快照，瞬間吃記憶體 | 每秒一次磁碟寫入 |

實務常見兩個一起開：RDB 當備份和快速還原的底，AOF 補上最近的寫入。重啟時 Redis 從磁碟檔還原到 RAM 再開始服務。

要不要在意丟資料，看放什麼。cache 場景丟 1 秒沒差，重新從 DB 載入就好；拿 Redis 當主要儲存（計數器、佇列）就要開 AOF，甚至 `appendfsync always`（每筆都 fsync，明顯變慢）。
