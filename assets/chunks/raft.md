---
title: "Raft"
slug: raft
brief: "Leader 選舉 + log 複製。設計上就是要讓人看得懂。"
date: 2026-03-09
updated: 2026-10-18
revisions: 3
---

# Raft

Raft 是分散式共識演算法：讓一群節點對每一筆資料變更達成一致，少數機器掛掉也不影響結論。[Paxos](chunk://paxos) 早就把這題解了，只是很難懂；Raft 做一樣的事，設計目標很單純，讓人看得懂。

## 怎麼運作

三個節點 N1、N2、N3，N1 是 leader。每個節點手上有一份 log，一筆一筆往後接，還有一份 state，是 log 從頭重播出來的結果。

client 送 `set x=5` 進來，照順序走：

```text
client → N1：set x=5
N1 把 set x=5 接在自己 log 的第 7 筆，還沒套用到 state
N1 → N2、N3：第 7 筆是 set x=5，複製過去
N2 寫進自己的 log，回覆 N1；N3 比較慢，還沒回
N1 算一下，自己加 N2 已經兩票，三取二過了，第 7 筆 commit
N1 把 x=5 套用到 state，回 client：成功
N3 稍後補上，自己也 commit 第 7 筆
```

只有 leader 收寫入，所以 log 的順序只有一個人在決定。commit 過的那一段，三份 log 一模一樣，重播出來的 state 也一樣。還沒 commit 的尾端倒是可能不一樣，後面 N1 斷電的例子就有一筆。commit 的門檻是多數，三個節點要兩個，五個節點要三個，所以三節點可以掛一台、五節點可以掛兩台，資料還在剩下的多數裡。

接著 N1 斷電。N2、N3 平常每 100ms 左右會收到 N1 的 heartbeat，現在收不到了。每個 follower 的等待時間是隨機的，假設 N2 抽到 150ms、N3 抽到 280ms。150ms 一到，N2 先超時，term 加一變成選舉人，投自己一票，再向 N3 要票。N3 這時還在等，收到請求發現 N2 的 log 不比自己舊，就投給 N2。N2 兩票過半，成為新 leader，開始發 heartbeat，N3 收到就安靜下來，不會再發起自己的選舉。隨機的等待時間就是為了這個，要是兩個都 150ms 超時，各投自己一票，一比一打平，只能再抽一輪。

假設 N1 斷電前，剛把 client 送來的 `set y=1` 接在自己 log 的第 8 筆，還沒複製出去。N1 修好重開機，Raft 的節點開機一律是 follower，所以 N1 醒來就是 follower，不會以 leader 的身分回來。N2 的 heartbeat 帶著比較大的 term 進來，N1 把自己的 term 更新成 N2 的。heartbeat 其實是不帶資料的 AppendEntries，N2 用它跟 N1 對 log，對到第 7 筆兩邊一致，就要 N1 刪掉第 7 筆之後的 entry，再把自己後面的 log 推給 N1。N1 那筆 `set y=1` 從來沒複製到多數節點，所以沒有 commit；client 也沒收到成功的回覆，這筆寫入就當作沒發生。

## Trade-offs

- 比 Paxos 好懂，實作更直接，etcd、Consul、CockroachDB 都用它
- 強一致性，commit 過的資料所有節點最後都一樣
- Leader failover 幾百毫秒，client 幾乎感覺不到
- 寫入要等多數回覆，latency 比單節點高
- 所有寫入都經過 leader 一台，寫入吞吐量受限於這一台
