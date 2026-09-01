---
title: "CSI → CRI → CNI → OCI：一個 Pod 背後的四份合約"
slug: four-interfaces-one-pod
date: 2026-04-12
subtitle: "kubelet 不建容器、不設網路、不掛 volume。它打四通電話，每通打給不同的承包商。"
chapter: "extras"
tags: [k8s, cri, oci, cni, csi, containerd, runc]
related: [cni-network, k8s-planes, packet-journey]
---

# CSI → CRI → CNI → OCI：一個 Pod 背後的四份合約

kubelet 自己不建容器、不設網路、不掛 volume，也不拉 image。它把這四件事外包出去，打四通電話，每通給不同的承包商。

每個承包商有一個標準化的接口，合約只寫「我不管你是誰，把這件事做好」。承包商會換。接口不會。

```
kubelet
  ├─ CSI  → 「給我一個 volume」
  ├─ CRI  → 「建一個 sandbox，跑一個 container」
  │    ├─ CNI  → 「幫這個 sandbox 接上網路」
  │    └─ OCI  → 「image 規格在這，runtime 規格在這，去吧」
  └─ (kubelet 自己什麼都不做)
```

[CSI](chunk://csi)、[CRI](chunk://cri-cni)、[CNI](chunk://cri-cni)、[OCI](chunk://oci)，四個接口，四個承包商。

這篇文章追蹤一個 Pod 從 `kubectl run nginx` 到容器跑起來的完整過程。每個接口，每個呼叫，按順序走。

---

## 為什麼要四個接口

2014 年，kubelet 只會做三件事：

跟 Docker 講話。

跟 Docker 講話。

跟 Docker 講話。

Runtime、networking、storage，全部硬寫在 Docker 的 API 上。

後來替代方案出現了。rkt 想當 runtime。Flannel 和 Calico 想管 networking。Ceph 和 EBS 想提供 storage。每多一個玩家就要改一次 kubelet 的程式碼。

K8s 做了任何理智的專案都會做的事：抽接口。讓 kubelet 講標準協定，讓實作在後面競爭。

| 接口 | 抽出時間 | 為什麼 |
|---|---|---|
| **CNI** | 2015 | CoreOS 的 rkt 需要容器網路。CNI 是 CNCF spec，不專屬 K8s。 |
| **CRI** | 2016 | rkt 想插進 K8s 當 runtime。不抽接口就要把第二套 runtime 硬寫進 kubelet。 |
| **CSI** | 2017 | 每家雲的 storage driver 都編譯進 K8s 核心。加新的要提 PR 給 K8s 本身。 |
| **OCI** | 2015 | Docker 把 image 格式和 runtime spec 捐給中立基金會。不然每個 runtime 各發明各的。 |

四個問題，各自抽出一個接口。它們被創造的順序不重要。建 Pod 時被呼叫的順序才重要。

---

## 時間軸：一個 Pod，四個接口

```
$ kubectl run nginx --image=nginx

 t=0   API Server 寫 Pod 到 [etcd](chunk://etcd)（status: Pending）
 t=1   Scheduler 選一個 Node（status: Pending，nodeName 設定好）
 t=2   那個 Node 上的 kubelet 發現新 Pod
        │
        ├─ t=3  CSI: Provision + Attach + Mount volume
        │        （如果沒 PVC 就跳過 — nginx 沒有，但我們還是走一遍）
        │
        ├─ t=4  CRI: RunPodSandbox()
        │        │
        │        └─ t=4.1  CNI: 在 sandbox 裡面設定 pod 網路
        │
        ├─ t=5  CRI: PullImage() ← OCI Image Spec
        │
        ├─ t=6  CRI: CreateContainer() ← OCI Runtime Spec (config.json)
        │
        ├─ t=7  CRI: StartContainer()
        │        containerd → shim → runc → container 跑起來
        │
 t=8   kubelet 更新 Pod status（status: Running）
```

CSI 最先。CRI 啟動後，CNI 在裡面發生。OCI 被用了兩次，一次是 image 格式，一次是 runtime config。逐一來看。

---

## CSI：「給我一個 volume」

Container Storage Interface。kubelet 和 storage provider 之間的對話。

### 它解決什麼問題

CSI 之前，每個 storage backend（AWS EBS、GCE PD、Ceph、NFS、iSCSI）都是編譯進 K8s 原始碼的 plugin，叫 in-tree driver。要加一個新的：

1. 用 Go 寫 driver
2. 提 PR 到 `kubernetes/kubernetes`
3. 等 K8s maintainer review，他們不懂你的 storage 系統
4. 跟著下一版 K8s 一起發佈
5. 全世界每個 K8s cluster 都帶著你的 driver binary，即使沒人用

K8s 曾有 20+ 個 in-tree storage driver。每一個都是維護負擔。每一個都要跟 K8s 的 release cycle 同步。

CSI 把 driver 搬出 K8s binary。CSI driver 以 Pod 的形式跑在 cluster 上。kubelet 透過 Unix socket 跟它溝通。誰都能寫，隨時能發佈，獨立升級。

### 三個階段

一個 volume 要經過三個階段，container 才能用它：

```
階段 1: Provision（建立實際的磁碟）
  │  CSI Controller: CreateVolume()
  │  「AWS，幫我開一個 10Gi gp3 EBS volume，放在 us-east-1a」
  │  → AWS 回傳 vol-0abc123
  │
階段 2: Attach（把磁碟接到 Node 上）
  │  CSI Controller: ControllerPublishVolume()
  │  「AWS，把 vol-0abc123 掛到 instance i-xyz789」
  │  → EBS volume 在 Node 上出現為 /dev/nvme1n1
  │
階段 3: Mount（讓 container 能用）
     CSI Node: NodeStageVolume() + NodePublishVolume()
     「把 /dev/nvme1n1 格式化成 ext4，mount 到 /var/lib/kubelet/pods/<id>/volumes/」
     → 目錄就緒。kubelet 把它當 bind mount 傳給 CRI。
```

階段 1 和 2 在 CSI Controller 上跑（通常是一個 Deployment）。階段 3 在 CSI Node 上跑（每個 Node 的 DaemonSet）。Controller 跟雲端 API 講話，Node 做本地 filesystem 操作。

### 你的 cluster 跑的

看 kubelens 的 k8s-snapshot，kube-system 裡有：

```
ebs-csi-controller-...   6/6   Running  ← Controller + 5 個 sidecar
ebs-csi-node-...         3/3   Running  ← 每個 Node 一個
efs-csi-controller-...   3/3   Running  ← 同樣的架構，給 EFS（NFS-like）
efs-csi-node-...         3/3   Running
```

兩個 CSI driver：**EBS**（block storage）和 **EFS**（shared storage）。Controller 那個 6/6 代表 1 個 CSI plugin + 5 個 sidecar（provisioner、attacher、snapshotter、resizer、liveness-probe）。

### CSI 和其他接口的順序

CSI 跑在 **CRI 之前**。Volume 必須先 mount 到 Node 上，container 才能啟動。如果 EBS volume attach 花了 30 秒，Pod 就會在 `ContainerCreating` 卡 30 秒。kubelet 不會在 volume 好之前呼叫 `RunPodSandbox`。

例外：`emptyDir` 和 `hostPath` 不走 CSI。它們是本地目錄，kubelet 自己處理。

---

## CRI：「建一個 sandbox，跑一個 container」

Container Runtime Interface。kubelet 和 container runtime 之間的對話。

完整故事在 [Container Runtime: A Divorce Story](/v2/container-runtime-evolution) 和 [containerd-shim 和 runc 的內部運作](/v2/containerd-shim-and-runc)。這裡聚焦 CRI 在 Pod 建立時間軸上的角色。

### 兩個 gRPC service

CRI 是一條 gRPC 連線，暴露兩個 service：

**RuntimeService** — Pod 和 container 生命週期：

```
RunPodSandbox()     → 建立 network namespace（觸發 CNI）
CreateContainer()   → 準備 container（OCI bundle）
StartContainer()    → 啟動（containerd → shim → runc）
StopContainer()     → SIGTERM → SIGKILL
RemoveContainer()   → 清理
```

**ImageService** — image 管理：

```
PullImage()    → 從 registry 拉（OCI Image Spec）
ListImages()   → 本地有什麼？
RemoveImage()  → 刪除快取
```

### Sandbox 是什麼

CRI 裡的「sandbox」不是 container。它是同一個 Pod 裡所有 container 共享的環境：

- 一個 network namespace（同 Pod 的 container 共享一個 IP）
- 一組 Linux namespace（IPC、UTS）
- 持有這些 namespace 的 pause container

kubelet 呼叫 `RunPodSandbox()` 時，[containerd](chunk://containerd)：

1. 建立一個 [pause container](chunk://pause-container)（一個只會 sleep 的小 process）
2. pause container 的 network namespace 變成 Pod 的 network namespace
3. **呼叫 CNI** 在那個 namespace 裡設定網路
4. 回傳 sandbox ID 給 kubelet

之後建立的所有 container 都會加入這個 sandbox 的 namespace。這就是為什麼同一個 Pod 裡的 container 共享 `localhost` — 它們在同一個 network namespace，由 pause container 建立。

---

## CNI：「幫這個 sandbox 接上網路」

Container Network Interface。container runtime 和 network plugin 之間的對話。

完整拆解在 [Pod 有 IP，是誰給的](/sd/cni-network)。

### CNI 被誰呼叫

CNI **不是 kubelet 呼叫的**。是 CRI runtime（containerd 或 CRI-O）在 `RunPodSandbox()` 過程中呼叫的。

```
kubelet
  │ CRI: RunPodSandbox()
  ▼
containerd
  │ 1. 建 pause container + network namespace
  │ 2. 用那個 namespace 呼叫 CNI plugin
  ▼
CNI plugin (aws-vpc-cni)
  │ 1. 從 VPC ENI 分配一個 IP
  │ 2. 建 veth pair
  │ 3. 把一端移進 pod namespace
  │ 4. 設定 route
  │ 回傳 IP 給 containerd
  ▼
containerd
  │ 回傳 sandbox ID + IP 給 kubelet
  ▼
kubelet
  │ 「sandbox 好了，接下來拉 image、建 container」
```

CNI 發生在 CRI 裡面。kubelet 不直接呼叫 CNI，它甚至不知道裝了哪個 CNI plugin。那是 containerd 的事。

---

## OCI：「規格在這，去吧」

Open Container Initiative。不是 runtime，不是工具。兩份 spec。

### Image Spec — image 怎麼包裝

kubelet 呼叫 `CRI PullImage("nginx:latest")` 時，containerd 從 registry 拉一個 OCI image。Image 是一疊 layer：

```
nginx:latest
  ├─ manifest.json     ← 「這個 image 有 5 層，digest 分別是...」
  ├─ config.json       ← 「CMD nginx, EXPOSE 80, ENV PATH=...」
  └─ layers/
      ├─ sha256:a1b2c3...  ← base debian filesystem
      ├─ sha256:d4e5f6...  ← apt install nginx
      ├─ sha256:g7h8i9...  ← copy nginx.conf
      └─ ...
```

每一層是一包 filesystem 差異（新增/修改/刪除的檔案）的 tar。Layer 是 **content-addressable**，名字就是 hash。內容一樣，hash 一樣，跨 image 共用。拉 `nginx` 和 `node`，它們共享同一個 debian base layer，只下載一次。

Docker 發明了這個格式，捐給 OCI。`docker pull`、`ctr pull`、`crictl pull` 拿到的是同一堆 bytes。

### Runtime Spec — container 怎麼建

kubelet 呼叫 `CRI CreateContainer()` 時，containerd 準備一個 **OCI bundle**：

```
/run/containerd/.../
  ├─ config.json    ← namespace、cgroup、mount、env、entrypoint
  └─ rootfs/        ← 解壓後的 image layers（union mount）
```

`config.json` 是 [OCI](chunk://oci) Runtime Spec。[runc](chunk://runc) 讀這份檔案就知道一切：

```json
{
  "process": {
    "args": ["nginx", "-g", "daemon off;"]
  },
  "linux": {
    "namespaces": [
      { "type": "pid" },
      { "type": "network", "path": "/proc/<pause-pid>/ns/net" }
    ],
    "resources": {
      "memory": { "limit": 268435456 }
    }
  },
  "mounts": [
    { "destination": "/data", "source": "/var/lib/kubelet/pods/<id>/volumes/..." }
  ]
}
```

注意 `namespaces.network.path`，指向 pause container 的 network namespace。新 container 加入已有的 Pod 網路。這個網路是 CNI 在 `RunPodSandbox()` 時設好的。

注意 `mounts`，CSI 把 volume mount 到了 host 上的某個路徑。containerd 把它寫進 `config.json` 當 bind mount。runc 讀到後 mount 進 container 的 filesystem。

**四個接口在這裡匯合：[CSI](chunk://csi) 準備了 mount。[CNI](chunk://cri-cni) 準備了 network namespace。CRI 準備了 [OCI](chunk://oci) bundle。[runc](chunk://runc) 從一份 config.json 讀到全部。**

---

## 全景圖

```
kubectl run nginx --image=nginx
  │
  ▼
API Server → etcd → Scheduler → 選一個 Node
  │
  ▼
kubelet（在那個 Node 上）
  │
  │  ┌──── CSI ────────────────────────────────────────┐
  │  │  external-provisioner 監聽 PVC                   │
  │  │    → CSI Controller: CreateVolume()              │
  │  │    → AWS API: 建 EBS volume                     │
  │  │  external-attacher 監聽 VolumeAttachment          │
  │  │    → CSI Controller: ControllerPublishVolume()   │
  │  │    → AWS API: 把 EBS 掛到這台 EC2               │
  │  │  kubelet 呼叫 CSI Node plugin:                   │
  │  │    → NodeStageVolume()（格式化 + mount 到 staging）│
  │  │    → NodePublishVolume()（bind mount 到 pod 目錄）│
  │  │  結果: volume 路徑就緒                           │
  │  └─────────────────────────────────────────────────┘
  │
  │  ┌──── CRI: RunPodSandbox() ───────────────────────┐
  │  │  containerd 建 pause container                   │
  │  │  containerd 建 network namespace                 │
  │  │                                                  │
  │  │  ┌──── CNI ──────────────────────────────────┐  │
  │  │  │  containerd 呼叫 CNI plugin (aws-vpc-cni)  │  │
  │  │  │    → 從 ENI secondary pool 分配 IP         │  │
  │  │  │    → 建 veth pair                          │  │
  │  │  │    → 設定 route                            │  │
  │  │  │  結果: Pod 拿到 IP 10.100.x.x              │  │
  │  │  └───────────────────────────────────────────┘  │
  │  │                                                  │
  │  │  結果: sandbox 就緒（namespace + 網路 + IP）     │
  │  └─────────────────────────────────────────────────┘
  │
  │  ┌──── CRI: PullImage() ──────────────────────────┐
  │  │  containerd → registry 拉 nginx:latest          │
  │  │  OCI Image Spec: 下載 manifest + layers         │
  │  │  Content-addressable: 已有的 layer 跳過         │
  │  └─────────────────────────────────────────────────┘
  │
  │  ┌──── CRI: CreateContainer() ────────────────────┐
  │  │  containerd 準備 OCI bundle:                    │
  │  │    config.json:                                 │
  │  │      namespace.network → pause container 的 netns│
  │  │      mounts → CSI 的 volume 路徑                │
  │  │      resources → Pod spec 的 limits             │
  │  │    rootfs → 解壓後的 image layers               │
  │  └─────────────────────────────────────────────────┘
  │
  │  ┌──── CRI: StartContainer() ────────────────────┐
  │  │  containerd → containerd-shim-runc-v2 → runc   │
  │  │  runc 讀 config.json:                           │
  │  │    加入 network namespace（CNI 設的）            │
  │  │    bind mount volume（CSI 設的）                │
  │  │    設 cgroup limits                             │
  │  │    pivot_root 進 rootfs（OCI image layers）     │
  │  │    exec nginx                                   │
  │  │  runc 退出。shim 留下。container 跑起來。       │
  │  └─────────────────────────────────────────────────┘
  │
  ▼
kubelet 更新 Pod status → API Server → etcd
  status: Running
  podIP: 10.100.x.x
```

一份 config.json 把所有東西串在一起。CNI 的 network namespace、CSI 的 volume mount、OCI 的 rootfs、CRI 的生命週期管理，全部匯聚在那份檔案裡。runc 讀一次，建出 container。

---

## 壞掉的時候

每個接口獨立失敗。知道是哪個壞了，就知道去哪裡看。

| 症狀 | 哪個接口 | 去哪裡看 |
|---|---|---|
| Pod 卡在 `Pending` | 沒有 — Scheduler 找不到 Node | `kubectl describe pod` → Events |
| Pod 卡在 `ContainerCreating`，等 volume | **CSI** | CSI controller logs、VolumeAttachment objects |
| Pod 卡在 `ContainerCreating`，沒拿到 IP | **CNI** | `aws-node` logs、`/var/log/aws-routed-eni/` |
| `ImagePullBackOff` | **CRI**（ImageService） | Registry 認證、到 registry 的網路、image 名字打錯 |
| `CrashLoopBackOff` | **OCI**（runtime） | Container 起來但 process 立刻退出。是 app 的 bug，不是 infra |
| `RunContainerError` | **CRI**（RuntimeService） | containerd logs、shim logs、runc debug |
| Container 跑了但沒有網路 | **CNI** | CNI plugin 沒跑或跑失敗了 |
| Container 跑了但 volume 是空的 | **CSI** | Mount 成功但 PVC 錯了，或 provisioning 失敗 |

---

## 四個承包商，比較一次

| | CSI | CRI | CNI | OCI |
|---|---|---|---|---|
| **誰呼叫它** | kubelet | kubelet | containerd（在 CRI 裡面） | containerd（在 CRI 裡面） |
| **協定** | gRPC over Unix socket | gRPC over Unix socket | exec binary + JSON stdin | spec（檔案，不是網路） |
| **什麼時候** | CRI 之前 | CSI 之後 | RunPodSandbox 期間 | Pull + Create 期間 |
| **跑在** | Pod（Controller + Node DaemonSet） | System service（containerd） | /opt/cni/bin/ 裡的 binary | Library/tool（runc） |
| **你的 cluster** | EBS CSI + EFS CSI | containerd | aws-vpc-cni | runc |
| **替代方案** | Ceph, NFS, Longhorn | CRI-O, cri-dockerd | Calico, Cilium, Flannel | gVisor, kata |

CNI 是最奇怪的一個。不是 gRPC — 是 exec 一個 binary，JSON 從 stdin 進去。四個裡面最簡單的協定。沒 daemon，沒 socket，沒持久連線。呼叫 binary，拿到 IP，結束。

OCI 更特別，它根本不是協定。它是檔案格式 spec。沒 server，沒 client。只是「config.json 和 image layers 長這樣」。runc 讀檔案，不牽涉網路。

---

## 為什麼這個架構重要

每個接口是一條接縫。接縫讓你換掉實作而不動 kubelet。但接縫也製造故障邊界、版本 skew、debug 複雜度。

回報：你可以用同一個 `kubectl run nginx`，在 bare metal 上跑 Calico + Ceph，在 AWS 上跑 VPC CNI + EBS，在筆電上跑 kind + local storage。kubelet 不用改，換的只是四個接口後面的實作，接口本身沒動。

K8s 是用慘痛經驗學到這件事的，先硬寫 Docker，花六年抽出來。dockershim 不只是 Docker 的問題：你只要跳過接口直接接實作，最後就得永遠養一個翻譯層。

---

## References

- [CRI API protobuf definition](https://github.com/kubernetes/cri-api/blob/v0.33.1/pkg/apis/runtime/v1/api.proto)
- [CSI Spec](https://github.com/container-storage-interface/spec/blob/master/spec.md)
- [CNI Spec](https://www.cni.dev/docs/spec/)
- [OCI Image Spec](https://github.com/opencontainers/image-spec)
- [OCI Runtime Spec](https://github.com/opencontainers/runtime-spec)
- [Container Runtime: A Divorce Story](/v2/container-runtime-evolution)
- [containerd-shim 和 runc 的內部運作](/v2/containerd-shim-and-runc)
- [Pod 有 IP，是誰給的](/sd/cni-network)
