---
title: "kubectl apply then what happens under the hood?"
slug: k8s-planes
date: 2026-03-09
updated: 2026-06-08
revisions: 1
subtitle: "打一行指令下去，背後六個元件各自接力，全程沒有人在指揮。"
chapter: "extras"
tags: [k8s, architecture, control-plane]
related: [etcd-raft, before-k8s, four-interfaces-one-pod]
---

# kubectl apply then what happens under the hood?

你打了 `kubectl apply -f deployment.yaml`，按下 enter。三十秒後，某個 node 上跑起了一個 pod。中間發生了什麼？

（`kubectl` 本身只是一個 HTTP client。它把你的 YAML 打包成 REST request，送到 API server。你在終端機打 `kubectl get pods`，等於瀏覽器打 `GET /api/v1/pods`。所有操作都是打 API server，`kubectl` 只是幫你組 request 的工具。）

六個元件碰了你的請求。它們之間不會互相喊話，也沒有一個老大在發號施令，每個元件各自盯著變化，看到自己在乎的東西，就行動。

接下來就是那三十秒裡發生的事。

---

## 第一站：API Server

第一個收到你 YAML 的是 API server。它驗證請求、確認你的身份，然後做一件事：把 pod spec 寫進 etcd。

它不會通知 scheduler，也不會通知 kubelet。它不知道誰會讀這筆資料。

API server 是 stateless 的。它自己不記任何東西。如果它 crash 再重啟，什麼都不會丟，因為它已經寫進 etcd 了。

## 第二站：etcd — 唯一的真相來源

etcd 是一個分散式 key-value store。不是關聯式資料庫，不是快取。就是一本字典。

```
/registry/pods/default/my-pod → { "spec": {...}, "status": {"phase": "Pending"} }
```

key 是路徑，value 是 JSON。etcd 就做這件事。

為什麼不用 Postgres？因為 k8s 對儲存有三個需求：

1. **資料量小** — 存的是叢集狀態，不是使用者資料。頂多幾 GB。
2. **強一致性** — 兩個 scheduler 不能看到不同的狀態。
3. **高效的 watch** — 叢集裡每個元件都需要在資料變化時被通知。

Postgres 能做到 1 和 2。但 3 不是它的強項。

為什麼不用 Redis？Redis 是快取。快，但可能丟資料。etcd 慢是慢一點，但它不會給你錯的，它說 pod 在，pod 就一定在。etcd 掛了，整個叢集失憶，無法操作。

etcd 跑在 3 或 5 個節點上，用 [Raft](chunk://raft) 共識演算法保持它們同步。那是下一篇文章的事。

## 第三站：Watch 機制

k8s 有趣的地方在這裡。沒有元件在 polling，也沒有元件在等指令，每個都是自己盯著看。

[Scheduler](chunk://scheduler) 跟 API server 開一條長期存在的 HTTP 連線：

```
GET /api/v1/pods?watch=true&fieldSelector=spec.nodeName=

HTTP/1.1 200 OK
Transfer-Encoding: chunked

{"type":"ADDED","object":{"metadata":{"name":"my-pod"},...}}
```

這個 response 永遠不結束。當 etcd 裡出現一個還沒被分配 node 的新 pod，API server 就往這條連線推一行 JSON。Scheduler 即時收到。

技術上就是一般的 HTTP request，但 response 用 `Transfer-Encoding: chunked` 保持開著。想像你打電話給氣象局，對方不掛電話，有新天氣就念給你聽。你不用每五分鐘重打（那是 polling）。也不用換電話線（那是 WebSocket）。就是一通電話不掛，有事就說。

### Watch 送的是差異，不是完整狀態

Watch 連線推過來的每一筆都是一個**差異事件**（delta），帶三種 type：

```json
{"type": "ADDED",    "object": {"metadata": {"name": "web-3", "resourceVersion": "4525"}, ...}}
{"type": "MODIFIED", "object": {"metadata": {"name": "web-2", "resourceVersion": "4524"}, ...}}
{"type": "DELETED",  "object": {"metadata": {"name": "web-1", "resourceVersion": "4530"}, ...}}
```

`ADDED` = 新建、`MODIFIED` = 有欄位變了、`DELETED` = 被刪了。只傳「變了的那一筆」，不是「把 5000 個 pod 的完整名單重新送一次」。

etcd 內部每次有寫入（create / update / delete），全域版本號 +1，變更記錄帶著版本號存下來。想像一本流水帳：

```
version 4521: Pod "web-1" created   → Pending
version 4522: Pod "web-1" modified  → Running
version 4523: Pod "web-2" created   → Pending
version 4524: Pod "web-2" modified  → Running
version 4525: Pod "web-3" created   → Pending
```

Scheduler 的 watch 就是在讀這本流水帳。有新的一行出現，API server 就念給你聽。

### 連線斷了怎麼辦

每筆事件帶的 `resourceVersion` 就是流水帳上的行號。Scheduler 重連時帶上最後收到的號碼：

```
GET /api/v1/pods?watch=true&resourceVersion=4523
```

「我上次看到第 4523 行，從 4524 開始念。」API server 從 etcd 找到 4524 之後的記錄，補發過來。中間不會漏。

但流水帳不會無限長。etcd 預設只保留最近 5 分鐘的歷史。如果 scheduler 斷線超過 5 分鐘才回來，帶的 `resourceVersion` 已經被清掉了，API server 回 `410 Gone`（「那頁已經撕掉了」）。這時 scheduler 要做一次全量重新同步，重新拿一次完整的 pod list，拿到最新的 resourceVersion，再從那裡開始 watch。

```
斷線 < 5 分鐘:
  帶上 resourceVersion=4523 → 接著念 4524, 4525...

斷線 > 5 分鐘:
  帶上 resourceVersion=4523 → 410 Gone
  → 全量 GET /api/v1/pods（拿到最新 version=9999）
  → 重新 watch?resourceVersion=9999
```

k8s 裡每個元件都用這個機制。Scheduler watch 還沒排程的 pod。Kubelet watch 被分配到自己 node 的 pod。Kube-proxy watch service 和 endpoint 的變化。Controller manager watch deployment、replica set 等等。

沒有誰主動去通知誰，大家都是自己在盯著看。

## 第四站：Scheduler

Scheduler 看到一個 `spec.nodeName` 是空的 pod。它的工作：選一個 node。

它根據可用的 CPU、記憶體、affinity 規則、taint 和 toleration 給每個 node 打分。分數最高的贏。

Scheduler 不會聯絡那個 node。它只是把一個欄位寫回 API server：

```
spec.nodeName: "worker-3"
```

完成。Scheduler 的工作結束了。它回去繼續 watch。

## 第五站：Kubelet

在 worker-3 上，kubelet 一直在 watch API server，找被分配到自己 node 的 pod。它看到 `my-pod` 出現了。

Kubelet 不自己跑 container。它往下呼叫：

```
kubelet → containerd → runc → Linux kernel (namespaces, cgroups) → container 跑起來了
```

[Container](chunk://container) 跑起來之後，kubelet 把狀態回報給 API server。Pod 的 phase 從 `Pending` 變成 `Running`。

## 第六站：Kube-proxy

Pod 跑起來了，但還沒有其他 pod 能找到它。

Pod 的 IP 是暫時的。Pod 死了重建，新 IP。Scale up 從 1 變 3 個 replica，三個新 IP。不該有人追蹤這些。

k8s 的解法是 Service — 一個穩定的虛擬 IP（ClusterIP），永遠不變：

```
Pod A → Service IP (固定) → iptables/IPVS → Pod B-1, B-2, B-3 (會變)
```

Kube-proxy watch Service 和 Endpoint 的變化。新 pod 加入 service 時，kube-proxy 更新每個 node 上的 iptables 規則。Pod A 把流量送到 Service IP，kernel 路由到其中一個實際的 pod。Pod A 完全不知道有幾個 replica、跑在哪裡。

---

## 沒有指揮官的設計

再看一次整個流程：

```
kubectl → API server → etcd（寫入）
                        ↓ watch
                     Scheduler（選 node，寫回）
                        ↓ watch
                     Kubelet（建 container，回報狀態）
                        ↓ watch
                     Kube-proxy（更新 iptables）
```

沒有一個 orchestrator 在告訴每個元件做什麼。API server 不協調。它只接受寫入，推送 watch 事件。

這是宣告式設計。你告訴 k8s「我要 3 個 replica」，而不是「請在 node A 建 pod 1、node B 建 pod 2、node C 建 pod 3」。每個元件獨立地 reconcile 到目標狀態。

為什麼？兩個原因：

**容錯。** 任何元件都可以 crash 然後重啟。Scheduler 掛了？重啟就好。它 watch etcd，看到 pending 的 pod，從斷點繼續。它腦袋裡不留東西，所有狀態都放在 etcd。

**鬆耦合。** 加新元件不需要改現有的。新元件只要 watch API server，關心自己在乎的事件就好。這就是為什麼 k8s 生態能這樣長，像 admission controller、custom operator、service mesh，都透過同一個 watch 機制接進來。

---

## 這篇沒講到的

**[Raft](chunk://raft)** — [etcd](chunk://etcd) 怎麼讓 3 個節點保持同步又不丟資料。那是下一篇。

**Controllers** — 管理 deployment、replica set、stateful set 的 reconciliation loop。每個 controller watch 期望狀態，跟實際狀態比較，然後行動。同一個 pattern，更多細節。

**網路深潛** — pod 之間的流量到底怎麼跨 node 傳遞。CNI plugin、overlay network，以及為什麼 kube-proxy 可能被 eBPF 取代。

這三個主題都是這篇的延伸。
