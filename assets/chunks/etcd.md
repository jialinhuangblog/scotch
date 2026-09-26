---
title: "Etcd"
slug: etcd
brief: "分散式 KV store。唯一的 source of truth。"
date: 2026-03-09
---

# Etcd

k8s 的所有狀態都存在 etcd。3 個節點，用 [Raft](chunk://raft) 達成共識。

## 特性

**1. 分散式 KV store**
存 k8s 的所有資源：Pods、Services、ConfigMaps。只有 API server 直接讀寫 etcd，controller 要讀資料也是透過 API server。

**2. 強一致性**
寫入 → leader 複製給多數 followers → commit。所以只要掛掉的不到半數，資料都還在。

**3. Watch API**
監聽 key 變化，觸發事件。API server watch etcd，controller 再 watch API server，reconciliation loop 就是這樣收到變化的。

## 為什麼是 etcd？

- **Raft 共識**：三個節點裡面，掛一個是可以的；五個節點裡面，掛兩個也可以
- **快**：寫入先 append 進 log，延遲通常是幾毫秒
- **可靠**：寫進 WAL（Write-Ahead Log）才回應，crash 後能恢復

## Trade-offs

- 強一致性，不會有 split brain（兩邊各自以為自己是 leader）
- Watch 機制讓 controller 立刻知道變化
- 寫入需要多數決，慢於單節點
- 不適合存大量資料，預設儲存上限 2GB，官方建議不超過 8GB
