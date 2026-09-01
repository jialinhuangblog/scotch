---
title: "Reconciliation"
slug: reconciliation
brief: "利用 nonstop 迴圈去不斷比對期望與實際狀態。"
date: 2026-04-08
updated: 2026-07-20
revisions: 3
---

# Reconciliation

k8s 不執行命令。你宣告「我要 3 個 nginx Pod」，controller 負責讓現實符合宣告。這個持續比對、修正的過程就是 reconciliation。

## Loop

每個 controller 跑同一個迴圈：

```text
loop:
  desired = 讀 etcd 裡的 spec（你要什麼）
  actual  = 觀察目前的狀態（現在是什麼）
  if actual != desired:
    執行動作讓 actual → desired
  sleep → 重複
```

Deployment controller 的例子：

```text
desired: replicas = 3
actual:  只有 2 個 Pod 在跑

動作：建立 1 個新 Pod
```

不是一次性的。Pod 掛了，下一輪 loop 又會發現 actual = 2，再補一個。

## 為什麼不用命令式

命令式：「啟動一個 Pod」。如果網路斷了，命令沒送到，Pod 就不會啟動。你不知道最終狀態是什麼。

聲明式 + reconciliation：「我要 3 個 Pod」寫進 etcd。不管中間發生什麼（網路斷、node 掛、container crash），controller 永遠會試圖把狀態修正回 3。

命令式一旦中間斷了就難救，聲明式把期望狀態記著，reconciliation 會自己收斂。

## 誰在跑 reconciliation

不只一個 controller。k8s 內建的：

| Controller | 管什麼 |
|---|---|
| Deployment controller | Pod 副本數、rolling update |
| ReplicaSet controller | 確保 Pod 數量符合 spec |
| Node controller | 偵測 node 掛了，標記 NotReady |
| Job controller | 確保 Job 跑完指定次數 |
| EndpointSlice controller | 更新 Service 背後的 Pod 清單 |

每個都是同一個 loop，換掉 desired 和 actual 而已：

```text
# Deployment controller
desired = Deployment.spec（replicas=3, template v2）
actual  = 它管的 ReplicaSet 們
差異    → 建新 ReplicaSet（v2），舊的逐步縮到 0（rolling update）

# ReplicaSet controller
desired = ReplicaSet.spec.replicas = 3
actual  = label 對得上的 Pod 數 = 2
差異    → 建 1 個 Pod（多了就刪）

# Node controller
desired = 每台 node 定期回報心跳
actual  = node-7 已經 40 秒沒回報
差異    → 標記 NotReady → 超過 eviction timeout 就開始撤離上面的 Pod

# Job controller
desired = completions = 5
actual  = 成功結束的 Pod = 3，還在跑 = 1
差異    → 再補 1 個 Pod，直到成功數達 5

# EndpointSlice controller
desired = Service selector 對到的 Ready Pod IP 清單
actual  = EndpointSlice 裡現存的 IP
差異    → 加上新 Pod 的 IP，移掉掛掉 Pod 的 IP
```

注意 Deployment controller 的 actual 不是 Pod，是 ReplicaSet：它只管 ReplicaSet，ReplicaSet 才管 Pod。每一層都只跑自己那個 loop，層層委派下去。

自訂的 controller（operator）也跑同一個 pattern。Argo CD 的 sync loop、cert-manager 的憑證更新，全是 reconciliation。

---

這個 loop 讀的是當前狀態，不是等事件通知。為什麼這樣選、漏掉觀察為什麼沒關係，拆在 [Edge vs Level Triggered](chunk://edge-vs-level-triggered)。

