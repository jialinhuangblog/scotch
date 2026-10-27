---
title: "etcd"
slug: etcd
brief: "分散式 KV store。唯一的 source of truth。"
date: 2026-03-09
updated: 2026-10-18
revisions: 2
---

# etcd

k8s 的所有狀態都存在 etcd，Pod、Service、ConfigMap 每一個都是裡面的一個 key，像 `/registry/deployments/default/web`，value 是那份物件的完整內容。etcd 通常跑 3 個節點，用 [Raft](chunk://raft) 達成共識。只有 API server 直接讀寫 etcd，controller 要讀資料也是透過 API server。

## 一次 kubectl scale 走一遍

執行 `kubectl scale deployment web --replicas=5`，照順序發生這些事：

```text
kubectl → API server：把 web 的 replicas 改成 5
API server → etcd leader：寫入 /registry/deployments/default/web
leader → 兩個 follower：複製這筆寫入
follower 回覆寫好了（至少一個，連 leader 就是三取二）
leader 回 API server：commit 成功
API server 回 kubectl：deployment 已更新
```

寫入要三個節點裡至少兩個落地才算成功。commit 的當下，第三台可能還沒收到這筆，所以這時候斷電的要是 leader，這筆可能只在一台 follower 上。資料還是不會丟，因為 Raft 選新 leader 時，節點不會投票給 log 比自己舊的候選人，所以沒收到這筆的那台拿不到過半的票，只有收到這筆的那台會當選。每一台落地的方式是先寫進 WAL（Write-Ahead Log）再回覆，所以自己 crash 重啟也能從 WAL 還原，不會回成舊的 replicas 3。

## Watch

寫入成功之後，沒有人去輪詢。deployment controller 早就對 API server 開了一條 watch，API server 又對 etcd 開著 watch，所以 etcd 那個 key 一變，事件就往上推，deployment controller 幾毫秒內收到「web 的 replicas 是 5」。它不直接建 Pod，而是把底下那個 ReplicaSet 的 replicas 從 3 改成 5，這又是一次經過 API server 寫進 etcd 的寫入。ReplicaSet controller 也開著 watch，收到這個變化，比對目前只有 3 個 Pod，才去建 2 個。Reconciliation loop 就是靠這條 watch 收到變化的。

## Trade-offs

- 強一致性。Raft 保證同一個 term（每選一次 leader 就加一的任期編號）最多選出一個 leader，但網路切成兩半時，被隔在少數那邊的舊 leader 可能還以為自己是 leader。它收不到多數回覆，所以寫入沒辦法 commit。etcd 的讀取預設是 linearizable，回應前要先跟多數確認自己還是 leader，所以舊 leader 也不會回應舊資料
- 寫入要多數決，比單機 KV 慢，一次寫入通常幾毫秒
- 不適合存大量資料，預設儲存上限 2GB，官方建議不超過 8GB，所以 container 的 log 不會放這裡
