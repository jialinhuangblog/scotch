---
title: "WAL"
slug: wal
brief: "Write-ahead log。改資料前先寫 log，機器當掉後也能從 log 還原資料。"
date: 2026-03-15
article: storage-deep
---

# WAL（Write-Ahead Log）

> 通用概念。DB 層面：InnoDB 叫 redo log，PostgreSQL 和 SQLite 叫 WAL。「先寫 log 再改狀態」的思路也出現在非 DB 系統：Kafka 的 log segment、Raft 的 replicated log。

先寫 log，再改 data page。機器當掉也不會丟資料。

## 問題

DB 改一筆資料，要更新 B+ Tree 的 leaf page。但 page 在磁碟上是隨機位置，random write 很慢。如果寫到一半斷電，那個 page 就壞了（partial write）。

## 解法

每次改資料之前，先把「我要做什麼改動」寫進一個 append-only 的 log 檔。Log 是 sequential write，速度快。就算最後一筆寫到一半斷電也沒關係。log 帶有 checksum（PostgreSQL 是每筆記錄一個 CRC-32C，InnoDB 是每個 log block 一個），重啟時會認出最後那筆不完整的記錄並丟棄。

寫完 log 才回覆 client「OK, committed」。真正改 data page 的工作可以之後慢慢做。

想成一台錄影機：動手改資料前，先讓它把「我要做什麼」錄下來。錄影是順順地錄（sequential write，快），改 data page 卻要在磁碟各處跑（random write，慢）。錄好就回覆 client，真正改 page 的工作在背景慢慢做；斷電重開，放錄影把沒做完的補一遍（redo），資料不會掉。

```text
1. 收到 UPDATE users SET name='Bob' WHERE id=1
2. 寫 WAL: "page 42, offset 100, 改成 Bob"    ← fsync 到磁碟
3. 回覆 client: OK
4. （背景）把 page 42 從 buffer pool 寫回磁碟  ← checkpoint
```

## Crash Recovery

機器重啟後，DB 讀 WAL，把沒寫完的改動重新套用到 data page。這叫 redo。每個 data page 上都記著最後套用到哪一筆 WAL（LSN，Log Sequence Number），redo 時已經套用過的記錄會跳過，所以 replay 不會重複套用。

## Checkpoint

如果永遠不把 dirty page 寫回磁碟，WAL 會無限長，重啟時要 replay 整個 WAL，太慢。

Checkpoint 就是把 buffer pool 裡的 dirty page flush 到磁碟，然後標記「到這裡為止的 WAL 可以丟了」。Recovery 只需要 replay checkpoint 之後的 WAL。

用錄影機來講，checkpoint 就是把錄下的改動真的寫進 B+ Tree page，寫完之後那段錄影帶（WAL）就能洗掉。

## InnoDB 寫入流程

```text
Client → Buffer Pool（改 page） → WAL（fsync） → 回覆 OK
                ↓
         背景 checkpoint → 寫回 data page
```

Buffer pool 是記憶體中的 page cache。查詢時先看 buffer pool，沒有才從磁碟讀。修改時也在 buffer pool 裡改，配合 WAL 保證 crash safety。

## 不只是 DB

WAL 的概念到處都是。Kafka 的 log segment、Raft 的 replicated log、etcd、ext4 的 journal，核心思想相同：先寫 log，再改狀態。
