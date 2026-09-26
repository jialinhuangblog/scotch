---
title: "Pod 的 IP 是誰分配的"
slug: cni-network
date: 2026-04-11
updated: 2026-06-11
revisions: 1
subtitle: "容器剛建立時沒有網路，CNI plugin 負責替它接上網路、分配 IP。"
chapter: "extras"
tags: [k8s, cni, networking, container, veth, linux]
related: [k8s-planes, packet-journey, four-interfaces-one-pod]
---

# Pod 的 IP 是誰分配的

Pod 跑起來了。跑 `kubectl get pod -o wide`，看到 IP `10.244.1.5`。

這個 IP 從哪來的？是 CNI（Container Network Interface）plugin 給的，kubelet 跟 containerd 都不負責分配 IP。

---

## 容器生下來沒有網路

每個容器跑在自己的 network namespace 裡。Network namespace 是 Linux kernel 的功能，讓一個 process 有自己的一套網路介面、routing table、iptables rules，跟其他 process 完全隔離。

新建的 netns 裡什麼都沒有，只有一個 `lo`：

```bash
ip netns add pod-a
ip netns exec pod-a ip link
# 1: lo: <LOOPBACK> mtu 65536
```

沒有 `eth0`，也沒有 IP，所以這個 pod 目前連不到 namespace 外面的任何地方。

---

## 一條穿牆的線：veth pair

Linux 有一種虛擬網路線叫 `veth`。它永遠成對出現。封包從一端送進去，另一端立刻收到，方向反過來也一樣。

想像 host 和 pod 是兩個房間，中間有一面牆。veth pair 就是一條穿牆的線，封包從這邊塞進去，那邊立刻掉出來。

```bash
# 建一對 veth，兩端暫時都在 host 的房間裡
ip link add veth_host type veth peer name veth_pod

# 把 pod 那端丟進 pod-a 的房間，貼上新標籤 eth0
ip link set veth_pod netns pod-a name eth0

# 開啟兩端（通電）
ip link set veth_host up
ip netns exec pod-a ip link set eth0 up
#└── 走進 pod-a 的房間 ──┘ └ 在裡面執行指令 ┘
```

現在：

```
[host netns]      [pod-a netns]
  veth_host  ←──→   eth0
```

`eth0` 是 pod 裡看到的網卡。封包從裡面進去，從 `veth_host` 那端出來。

---

## 一個節點有幾十個 Pod

一個 veth pair 只接通了一個 pod 跟 host。節點上有 N 個 pod，每個都有自己的 veth pair，但這些 host 端的 veth 彼此沒有相連：

```
veth_host_a ← pod-A
veth_host_b ← pod-B
veth_host_c ← pod-C
```

pod-A 要怎麼送封包給 pod-B？沒有辦法，它們之間沒有連接。

解法是 **bridge**。想像在 host 的房間裡放一台交換器（switch）。每條穿牆線的 host 端都插進這台交換器的 port，交換器讓它們彼此互通。

```bash
# 在 host 房間裡放一台交換器，叫 cni0
ip link add cni0 type bridge
ip link set cni0 up

# 把每條穿牆線的 host 端都插進交換器，然後通電
ip link set veth_host_a master cni0 && ip link set veth_host_a up
ip link set veth_host_b master cni0 && ip link set veth_host_b up
ip link set veth_host_c master cni0 && ip link set veth_host_c up
```

`master cni0` = 「這條線插在 cni0 這台交換器上」。插上去之後，交換器看 dst MAC 決定往哪個 port 轉發，跟實體 switch 的行為一模一樣，只是全部是軟體模擬的。

現在三個 pod 都在同一個 L2 網段。pod-A 送封包給 pod-B，走的路是：

```
pod-A eth0 → veth_host_a → bridge(cni0) → veth_host_b → pod-B eth0
```

封包不離開節點，由 bridge 直接轉發。

---

## IP 從哪來：IPAM (IP Address Management)

Bridge 接好了，但 pod 的 `eth0` 還沒有 IP。

CNI 把 IP 分配這件事抽成獨立的子 plugin，叫 IPAM（IP Address Management，IP 位址管理）。最常見的是 `host-local`：每個節點有一段分配給自己的 subnet（例如 `10.244.1.0/24`），host-local 維護一個本地檔案，記錄哪個 IP 已經被用掉：

```
/var/lib/cni/networks/mynet/10.244.1.2  ← 這個 IP 被 containerID xxx 占用
/var/lib/cni/networks/mynet/10.244.1.3  ← 這個 IP 被 containerID yyy 占用
```

每次有新 pod 要建立網路，IPAM 會找一個還沒有對應檔案的 IP，建立那個檔案，再把 IP 回傳給上層。pod 刪除時，IPAM 刪掉那個檔案，IP 就能再分配。

CIDR（Classless Inter-Domain Routing）是用前綴長度表示的一段連續 IP 範圍，例如 `10.244.1.0/24`。Kubernetes 的 node CIDR 分配保證每個節點的 subnet 不重疊，每個節點又只從自己的 subnet 發 IP，所以整個 cluster 裡每個 pod IP 都不重複。

---

## 封包怎麼跨節點

同節點兩個 pod 走 bridge，不出機器。但 pod-A 在 node-1、pod-B 在 node-2，中間隔著實體網路，得先在每台 node 上設好路由表或 VXLAN 裝置，封包才送得到對面。

**Flannel 和 Calico 共同的前提：** 一台 node 加進 cluster 時，k8s 先分給它一段不重疊的 pod 網段（node-1 拿 `10.244.1.0/24`、node-2 拿 `10.244.2.0/24`，就是前面 IPAM 講的 node CIDR）。這時還沒有任何 pod，只是先把「這台機器以後的 pod 用這段」定下來。等之後 pod-B 真的排到 node-2，node 上的 IPAM 才從這段裡挑一個具體 IP（`10.244.2.5`）給它。

pod 的 IP 一定落在它所在 node 的網段裡。所以光看 `10.244.2.5` 前綴 `10.244.2`，就知道它在 node-2。剩下的問題只是「`10.244.2.0/24` 這段對應到哪台實體機器」，Flannel 和 Calico 用兩種方式回答它。

**Flannel（VXLAN）：把封包裝進信封**

VXLAN（Virtual Extensible LAN）是把 L2 封包包進 UDP 送出去的隧道協議。

flannel 事先在一個共享的地方（etcd 或 k8s API）記一張表「哪段 pod 網段 → 哪台 node 的真實 IP」，每台 node 的 flanneld 都讀得到、同步到本地。

封包要跨 node 時，node-1 的 routing table 把目的地是別台 node 網段的封包交給 `flannel.1`（一個 VXLAN device）。`flannel.1` 查那張表知道 `10.244.2.0/24` 在 node-2 的 `192.168.1.20`，就把整個 pod 封包塞進一個 UDP 封包，外層寫 node-1 → node-2 的真實 IP，從實體網卡送出去。node-2 的 `flannel.1` 收到、拆掉外層，還原裡面的 pod 封包，交給 bridge，送進 pod-B。

```
pod-A eth0 → bridge → flannel.1(VXLAN) → node-1 eth0 → 網路 → node-2 eth0 → flannel.1(解包) → bridge → pod-B eth0
```

這就像寄信。「10.244.2.5」是郵局不認得的地址，所以把信裝進一個大信封，外面寫 node-2 的真實地址，到了再拆開，把裡面的信在本地投遞。好處是底層網路完全不用配合，代價是每個封包多一層裝、拆，延遲和 CPU 用量稍高。

**Calico（BGP）：把 pod 網段寫進每台 node 的路由表**

Calico 不裝信封，改成事先把路由表填好。布置的順序：

1. node-2 加入時拿到網段 `10.244.2.0/24`，真實 IP `192.168.1.20` 本來就有（機器網卡）。
2. node-2 跑的 [BGP](chunk://bgp) speaker 對其他 node 廣播：「`10.244.2.0/24` 走我 `192.168.1.20`」。
3. 其他 node 收到，寫進自己的 kernel routing table。
4. 這幾步在 pod 還沒生出來前就做完了。之後 pod-B 拿到 `10.244.2.5`，因為落在已經廣播過的網段裡，不用再為它單獨廣播一次。

布置好之後封包才開始跑。node-1 的 routing table 長這樣：

```text
10.244.1.0/24 dev cni0           # 自己的 pod，交給本地 bridge
10.244.2.0/24 via 192.168.1.20   # node-2 的 pod，下一跳是 node-2
```

pod-A 送給 `10.244.2.5`，node-1 的 kernel 拿這 IP 比對，最長前綴命中第二行，就當普通 IP 封包直接轉給 `192.168.1.20`。`192.168.1.20` 是實體網路上真的存在的位址，封包照一般路由就能送到，不用裝信封也不用拆信封。

```
pod-A eth0 → bridge → node-1 eth0 → IP routing → node-2 eth0 → bridge → pod-B eth0
```

BGP 的用途是自動替每台 node 填好這些 `via`，不用人手動寫。少了裝信封、拆信封這一步，延遲比 VXLAN 低，代價是底層網路要能跑 BGP，或每台 node 在同一個 L2。

---

## CNI 是什麼

CNI 就是一個約定：**plugin 是一個 binary，container runtime 透過環境變數和 stdin 呼叫它，結果從 stdout 讀回來。**

CNI 1.1 定義了五個 `CNI_COMMAND`：`ADD`（建網路）、`DEL`（清除）、`CHECK`（驗證）、`GC`（清掉沒人用的殘留資源）、`VERSION`（查版本）。前面 IPAM 分配 IP 就是在 `ADD` 裡發生的，pod 刪除時清掉 IP 則是 `DEL`。

```bash
CNI_COMMAND=ADD \
CNI_CONTAINERID=abc123 \
CNI_NETNS=/var/run/netns/abc123 \
CNI_IFNAME=eth0 \
CNI_PATH=/opt/cni/bin \
/opt/cni/bin/bridge < network-config.json
```

`bridge`、`calico`、`flannel`，都是 `/opt/cni/bin/` 下的 binary。runtime 找到它，exec 它，傳入 context，它建好網路，把結果 JSON 印到 stdout，然後退出。

呼叫 CNI 的不是 kubelet，是 containerd 的 CRI（Container Runtime Interface）plugin。它在處理 `RunPodSandbox` 的過程中建好 netns，再把 netns 路徑傳給 CNI。

這個設計讓換網路方案變得簡單：把 `/opt/cni/bin/` 裡的 binary 換掉，改一份 config JSON，其他什麼都不用動。

---

## 整個流程

```
kubelet 叫 containerd: RunPodSandbox
  → containerd 建 pause container（持有 netns）
  → containerd 呼叫 CNI ADD
    → bridge plugin: 建 veth pair，接上 cni0 bridge
    → IPAM(host-local): 分配 10.244.1.5，設定 eth0 IP 和 route
  → CNI 回傳結果
  → pod 的 eth0 有了 IP，能出節點，能和其他 pod 通訊
```
