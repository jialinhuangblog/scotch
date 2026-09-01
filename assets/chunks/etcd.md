---
title: "Etcd"
slug: etcd
brief: "分散式 KV store。唯一的 source of truth。"
date: 2026-03-09
---

# Etcd

k8s 的所有狀態都存在 etcd。3 個節點，用 [Raft](chunk://raft) 達成共識。

## 三個核心

**1. 分散式 KV store**
存 k8s 的所有資源：Pods、Services、ConfigMaps。API server 寫，controller 讀。

**2. 強一致性**
寫入 → leader 複製給多數 followers → commit。隨便哪一個節點掛掉，資料都還在。

**3. Watch API**
監聽 key 變化，觸發事件。controller 的 reconciliation loop 就靠這個。

## 為什麼是 etcd？

- **Raft 共識**：三個節點裡面，掛一個是可以的；五個節點裡面，掛兩個也可以
- **快**：記憶體 + append-only log，寫入幾毫秒
- **可靠**：寫進 WAL 才回應，crash 後能恢復

## Trade-offs

- 強一致性，不會有 split brain
- Watch 機制讓 controller 立刻知道變化
- 寫入需要多數決，慢於單節點
- 不適合大量資料（幾 GB 以上性能下降）
