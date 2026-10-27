---
title: "Redis Persistence"
slug: redis-persistence
brief: "Redis works in RAM and writes to disk through RDB snapshots or the AOF append log; AOF fsyncs every second by default, so at most one second is lost."
date: 2026-07-20
updated: 2026-10-18
revisions: 3
---

# Redis Persistence

Persistence means the data is still there after the process or the machine restarts. Data in RAM is gone when the power goes; data on an SSD stays. Redis does all its work in RAM, which is where its speed comes from, and the cost is that a restart wipes everything, so the data has to be written to disk separately.

Walk through it with a like counter. The key is `likes:post:42`, with about 1000 `INCR` calls per second. The machine loses power at 10:00:30.

**RDB** writes a snapshot of the whole RAM to one file at intervals. Say it is set to every 5 minutes and the last snapshot was at 10:00:00. Then the 30,000 INCRs between 10:00:00 and 10:00:30 are all gone, and after the restart the counter is back at its 10:00:00 value. The snapshot is written by a forked child process while the main process keeps serving, but under heavy writes copy-on-write makes memory use grow for a while.

**AOF** appends every command that changes data to the end of a file, the same approach as a database [WAL](chunk://wal). The default is `appendfsync everysec`, one fsync per second, so with the same power loss at 10:00:30 only the last second that was not yet fsynced is lost, about 1000 INCRs. On restart Redis replays the commands in the AOF before it starts serving, and 30,000 INCRs, about 1MB, are replayed one by one. But the file does not grow forever. By default, once the AOF is over 64MB and has doubled since the last rewrite, Redis rewrites it in the background, replacing the accumulated INCRs with one record that writes the current value of `likes:post:42` directly. One INCR takes about 34 bytes in the AOF, so this counter is rewritten once it reaches about two million INCRs. Sending three million INCRs to a local Redis 7.2 with default settings triggered one rewrite along the way, and the restart had only about one million left to replay. Replaying commands is slower than loading a snapshot, so an AOF restore is still slower than RDB.

| | RDB | AOF |
|---|---|---|
| Method | Snapshot the whole RAM to one file at intervals | Append every write command to a file |
| File | Small, fast restore | Larger than RDB, restore replays the commands since the last rewrite |
| How much is lost | Everything since the last snapshot | At most 1 second by default |
| Cost | A fork for the snapshot, memory grows for a while | Every command is write() to the AOF, one fsync per second |

In practice both are often on: `dump.rdb` serves as a backup and for moving data to another machine, and AOF keeps a power loss down to at most one second. With both on, a restart reads only the AOF; Redis does not read `dump.rdb`. The AOF restore is faster than you might expect because a Redis 7 AOF carries its own snapshot. It is a directory holding a base file and an incr file. The base file is the full dataset written at the last rewrite, in RDB format by default, and the incr file holds the commands since that rewrite. On restart Redis loads the base file, then replays the incr file. This base file and the `dump.rdb` that the `save` setting produces are two different files. Delete the AOF directory and Redis does not fall back to `dump.rdb`.

Used as a cache, losing 30 seconds does not matter; the data reloads from the DB. Used as the primary store, like this counter or a queue, AOF has to be on. When even that one second cannot be lost, switch to `appendfsync always`, which fsyncs every command, so every INCR waits for the disk and gets noticeably slower.
