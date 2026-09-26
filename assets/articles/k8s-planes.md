---
title: "kubectl apply 之後，k8s 裡發生了什麼"
slug: k8s-planes
date: 2026-03-09
updated: 2026-06-08
revisions: 1
subtitle: "打一行指令下去，背後六個元件各自 watch 變化、處理自己那一段，中間沒有任何元件負責協調。"
chapter: "extras"
tags: [k8s, architecture, control-plane]
related: [etcd-raft, before-k8s, four-interfaces-one-pod]
---

# kubectl apply 之後，k8s 裡發生了什麼

打了 `kubectl apply -f deployment.yaml`，按下 enter，三十秒後某個 node 上跑起了一個 pod。中間發生了什麼？

（`kubectl` 本身只是一個 HTTP client，會把 YAML 打包成 REST request 送到 API server。終端機打 `kubectl get pods`，等於瀏覽器打 `GET /api/v1/pods`。）

這個請求會經過六個元件。它們之間不互相呼叫，也沒有哪個元件負責指揮。每個元件各自 watch 變化，看到跟自己有關的才處理。

---

## 1. API Server

第一個收到 YAML 的是 API server。它驗證請求、確認身份，然後把 pod spec 寫進 etcd。

它不會通知 scheduler 或 kubelet，也不知道誰會讀這筆資料。

API server 是 stateless 的，自己不存狀態。它 crash 再重啟，什麼都不會丟，因為資料已經寫進 etcd 了。

## 2. etcd：唯一的真相來源

etcd 是一個分散式 key-value store，就像一本字典，key 是路徑，value 是 JSON：

```
/registry/pods/default/my-pod → { "spec": {...}, "status": {"phase": "Pending"} }
```

為什麼不用 Postgres？因為 k8s 對儲存有三個需求：

1. **資料量小** — 存的是叢集狀態，不是使用者資料。頂多幾 GB。
2. **強一致性** — 兩個 scheduler 不能看到不同的狀態。
3. **高效的 watch** — 叢集裡每個元件都需要在資料變化時被通知。

Postgres 能做到 1 和 2。但 3 不是它的強項。

為什麼不用 Redis 呢？Redis 是快取，速度快但可能丟資料。etcd 慢一點，但回傳的一定是已經 commit 的資料，查到 pod 存在，pod 就一定存在。代價是 etcd 一停，整個叢集就讀不到任何狀態，什麼都不能操作。

etcd 跑在 3 或 5 個節點上，用 [Raft](chunk://raft) 共識演算法保持它們同步，細節在 [etcd 那篇](article://etcd-raft)。

## 3. Watch 機制

這裡的元件既不 polling，也不等指令，而是自己 watch 變化。

[Scheduler](chunk://scheduler) 跟 API server 開一條長期存在的 HTTP 連線：

```
GET /api/v1/pods?watch=true&fieldSelector=spec.nodeName=

HTTP/1.1 200 OK
Transfer-Encoding: chunked

{"type":"ADDED","object":{"metadata":{"name":"my-pod"},...}}
```

這個 response 永遠不結束。當 etcd 裡出現一個還沒被分配 node 的新 pod，API server 就往這條連線推一行 JSON。Scheduler 即時收到。

技術上就是一般的 HTTP request，但 response 用 `Transfer-Encoding: chunked` 保持開著。想像打電話給氣象局，對方不掛電話，有新天氣就念出來。不用每五分鐘重打（那是 polling），也不用換電話線（那是 WebSocket）。

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

Scheduler 的 watch 就是在讀這本流水帳。有新的一行出現，API server 就推過來。

### 連線斷了怎麼辦

每筆事件帶的 `resourceVersion` 就是流水帳上的行號。Scheduler 重連時帶上最後收到的號碼：

```
GET /api/v1/pods?watch=true&resourceVersion=4523
```

「我上次看到第 4523 行，從 4524 開始念。」API server 從 etcd 找到 4524 之後的記錄，補發過來。中間不會漏。

但流水帳不會無限長。API server 預設每 5 分鐘對 etcd 做一次 compaction，把舊版本清掉。要是 scheduler 斷線太久，帶的 `resourceVersion` 已經被清掉了，API server 會回 `410 Gone`（「那頁已經撕掉了」）。這時 scheduler 要重新拿一次完整的 pod list，取得最新的 resourceVersion，再從那裡開始 watch。

```
resourceVersion 還在:
  帶上 resourceVersion=4523 → 接著念 4524, 4525...

resourceVersion 已經被 compaction 清掉:
  帶上 resourceVersion=4523 → 410 Gone
  → 全量 GET /api/v1/pods（拿到最新 version=9999）
  → 重新 watch?resourceVersion=9999
```

k8s 裡每個元件都用這個機制。Scheduler watch 還沒排程的 pod。Kubelet watch 被分配到自己 node 的 pod。Kube-proxy watch service 和 endpoint 的變化。Controller manager watch deployment、replica set 等等。

## 4. Scheduler

Scheduler 看到一個 `spec.nodeName` 是空的 pod，它的工作是選一個 node。

它先篩掉放不下的 node，例如資源不夠的，或是有 taint 而 pod 沒有對應 toleration 的。taint 是 node 標明拒收哪些 pod，toleration 是 pod 聲明自己可以被放上去。剩下的 node 再依可用資源跟 affinity 規則（pod 偏好跟誰放在同一台）打分，分數最高的勝出。

Scheduler 不會聯絡那個 node，只透過 API server 建一個 Binding，把 pod 的這個欄位設好：

```
spec.nodeName: "worker-3"
```

Scheduler 的工作到這裡結束，接著回去繼續 watch。

## 5. Kubelet

在 worker-3 上，kubelet 一直在 watch API server，找被分配到自己 node 的 pod。它看到 `my-pod` 出現了。

Kubelet 不自己跑 container。它往下呼叫：

```
kubelet → containerd → runc → Linux kernel (namespaces, cgroups) → container 跑起來了
```

[Container](chunk://container) 跑起來之後，kubelet 把狀態回報給 API server。Pod 的 phase 從 `Pending` 變成 `Running`。

## 6. Kube-proxy

Pod 跑起來了，但還沒有其他 pod 能找到它。

Pod 的 IP 是暫時的。Pod 死了重建，就換一個新 IP。Scale up 從 1 變 3 個 replica，就多了三個新 IP。要其他 pod 自己追蹤這些 IP 並不實際。

k8s 的解法是 Service，一個穩定、不會變的虛擬 IP（ClusterIP）：

```
Pod A → Service IP (固定) → iptables/IPVS → Pod B-1, B-2, B-3 (會變)
```

Kube-proxy watch Service 和 Endpoint 的變化。新 pod 加入 service 時，每個 node 上的 kube-proxy 會更新自己那台的 iptables 規則。Pod A 把流量送到 Service IP，kernel 路由到其中一個實際的 pod。Pod A 完全不知道有幾個 replica、跑在哪裡。

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

沒有一個 orchestrator 在指派工作。API server 不做協調，只接受寫入、推送 watch 事件。

這是宣告式設計。宣告的是「我要 3 個 replica」，而不是「請在 node A 建 pod 1、node B 建 pod 2、node C 建 pod 3」，然後每個元件各自把實際狀態 reconcile 到目標狀態。

這樣設計有兩個好處：

**容錯。** 任何元件都可以 crash 再重啟。Scheduler 掛了重啟就好，它重新 watch API server，看到還在 pending 的 pod，就從斷點繼續。它自己不存狀態，全在 etcd。

**鬆耦合。** 加新元件不需要改現有的，新元件只要 watch API server、處理自己關心的事件。所以 admission controller、custom operator、service mesh 這些後來的元件，都是透過同一個 watch 機制接進來的。

---

## Raft、Controller、跨 node 網路

**[Raft](chunk://raft)** — [etcd](chunk://etcd) 怎麼讓 3 個節點保持同步又不丟資料，在 [etcd 那篇](article://etcd-raft)。

**Controllers** — 管理 deployment、replica set、stateful set 的 reconciliation loop。每個 controller watch 期望狀態，跟實際狀態比較，然後行動，跟上面是同一個 pattern。

**跨 node 網路** — pod 之間的流量怎麼跨 node 傳遞，包括 CNI plugin、overlay network，以及 kube-proxy 為什麼可能被 eBPF 取代，在 [CNI 那篇](article://cni-network)。
