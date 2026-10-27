---
title: "Control Plane"
slug: control-plane
brief: "API server、scheduler、controller-manager。k8s 的決策都在這一層發生。"
date: 2026-03-09
updated: 2026-10-18
revisions: 2
---

# Control Plane

control plane 裡沒有一個總指揮。每個元件都透過 API server 監看 [etcd](chunk://etcd) 裡的狀態，etcd 是存所有 cluster 狀態的 key-value store，誰看到跟自己有關的變化就自己處理。

## 一次 apply 經過誰

拿 `kubectl apply` 一個 replicas: 3 的 nginx Deployment 走一遍。

```text
kubectl → API server：驗證身分、檢查權限，把 Deployment 寫進 etcd
Deployment controller 看到新的 Deployment → 寫一個 ReplicaSet 進 etcd
ReplicaSet controller 看到要 3 個 Pod、現在 0 個 → 寫 3 個 Pod 進 etcd，nodeName 空白
Scheduler 看到 3 個沒有 node 的 Pod → 替每台 node 算分，把 nodeName 填上去寫回
node-2 的 kubelet 看到有 Pod 排給自己 → 叫 container runtime 把 nginx 跑起來
```

五個角色沒有一個直接呼叫另一個。每一步都是看到 etcd 裡多了什麼，就寫下自己那一份決定。Scheduler 不啟動 Pod，只填 nodeName；kubelet 不管 Deployment 存不存在，只看有沒有 Pod 排給自己。前四步都在 control plane，最後一步的 kubelet 跟 node 上的 kube-proxy 叫 data plane，是實際跑 Pod 的地方。

## 三個核心元件

**API Server** 是唯一能讀寫 etcd 的入口，上面每一步的讀跟寫都經過它。**Scheduler** 只負責替沒有 node 的 Pod 挑 node。**Controller Manager** 是一群 controller 的集合，Deployment controller、ReplicaSet controller 都住在這裡，每個 controller 都在跑同一個迴圈：讀 desired state，比對 actual state，有差就動手，然後再讀一次。

## 這樣設計換到什麼

nginx 的 Pod 被人刪掉一個，ReplicaSet controller 下一輪比對看到 3 比 2，再寫一個 Pod 進 etcd，沒有人需要通知它。control plane 自己的機器掛了也一樣，狀態全在 etcd，換一台新的起來，接著上次的狀態繼續比對。前提是 etcd 沒有跟著那台機器一起不見。kubeadm 預設把 etcd 跟 API server 放在同一台 control plane 機器上，所以 HA 的做法是開 3 台 control plane，每台各跑一個 etcd member，壞一台還剩兩台，資料都在。只有一台 control plane 的 cluster，etcd 也在那台上，它的磁碟一壞，狀態就跟著沒了。

代價是每個元件都只認 etcd 裡這一份狀態。3 個 member 的 etcd 用 Raft 達成共識，壞一台還有兩台過半數，照常讀寫；壞到只剩一台，不到半數，API server 讀不到也寫不進，整個 control plane 停住。node 上已經在跑的 Pod 不受影響，但新的決定一個都做不了。
