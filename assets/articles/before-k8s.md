---
title: "在 k8s 之前，部署是人的工作"
slug: before-k8s
date: 2026-03-14
subtitle: "從手動 SSH，到 container，到 orchestrator，每一代都在解上一代的麻煩。"
chapter: "devops"
tags: [k8s, container, deploy, devops, desired-state]
related: [k8s-planes, helm-deep, deploy-practice]
---

# 在 k8s 之前，部署是人的工作

凌晨三點，手機響了。Production server 掛了。

打開筆電，SSH 進去，看 log，發現 OOM（記憶體用完，process 被 kernel 砍掉）。手動重啟 process。等三分鐘，確認恢復了。回去睡覺。

這是 2014 年的日常。

---

## 手動時代：一台 server，一個人

最早的部署長這樣：

```
筆電 → scp app.jar user@server:/opt/app/ → ssh user@server "systemctl restart app"
```

一台 server。一個 deploy script。有時候連 script 都沒有，就是一串記在腦裡的指令。

Scale 怎麼做？買更大的機器。CPU 不夠？升級。記憶體不夠？加。這叫 vertical scaling。有上限，而且很貴。

Horizontal scaling 呢？多買幾台。但現在有三台 server，每台要：

1. 裝同樣的 OS 版本
2. 裝同樣的 runtime（Java 8? Java 11?）
3. 裝同樣的系統 library
4. 複製同樣的 config 檔
5. 設定 Nginx 把流量分到三台

三台還行。三十台呢？

### Snowflake server

每台 server 都是獨一無二的。Server A 裝了 Java 11，Server B 不知道什麼時候被人手動升到 Java 17，Server C 有一個神秘的環境變數是兩年前某個工程師設的，沒人知道為什麼，但拿掉就會壞。

這叫 snowflake server，跟雪花一樣每台都長得不一樣，也沒辦法照著重建一台。因為沒人知道這台機器上到底裝了什麼，所以也沒人敢碰。

### 部署的恐懼

在這個世界裡，部署是危險的。每次部署都可能因為環境差異而失敗。所以團隊開始減少部署頻率，從一週一次拉長到一個月一次。

部署越少，累積下來的變更就越大，越容易出事，於是更不敢部署。

---

## Container：打包一切

2013 年，Docker 出現了，要解決的是「在我機器上沒問題，到 server 上就壞」這種狀況。

### 之前

App 依賴 Node.js 18、libssl 1.1、一個特定版本的 imagemagick。本機全裝好了，跑得很順。

推到 server 上，Node.js 是 16，libssl 是 3.0，imagemagick 沒裝。壞了。

接著花兩小時一台一台補裝。下次部署如果又多了新的依賴，就得再對一次。

### 之後

```dockerfile
FROM node:18-alpine
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["node", "server.js"]
```

`docker build` 把 app 跟所有 dependency 打包成一個 image。Image 建好就不會再變，本機跑的跟 production 跑的是同一個 image。

所以不用再一台一台對環境。Image 就是部署的 artifact，跟編譯出來的 binary 一樣，同一份放到哪台機器上跑，結果都相同。

### Container 的本質

Container 不是虛擬機。沒有 guest OS，沒有 hypervisor。它就是一個 Linux process，但被兩個 kernel 功能限制了：

Namespaces 隔離 process 能看見的資源。Container 裡的 process 看到的 PID 從 1 開始，看不到 host 的檔案系統，有自己的網路 stack，所以從裡面看出去，像是獨佔一整台電腦。

Cgroups 限制資源。CPU 最多用 0.5 核。記憶體最多 256MB。超過就 OOM kill。

Namespaces 負責隔離、cgroups 負責限制，兩個加起來就是 container。啟動時間是毫秒級，不像虛擬機需要分鐘級，因為不需要啟動 OS。

### Container 解決了什麼

| Before | After |
|---|---|
| 環境差異導致部署失敗 | Image 是不可變的，到處都一樣 |
| Snowflake server | Server 只需要裝 Docker |
| 部署 = 複製檔案 + 祈禱 | 部署 = 拉 image + 啟動 container |

### Container 沒解決的

一台機器上跑 container 很簡單。`docker run` 就好。

十台機器呢？

- 哪台機器跑哪個 container？
- Container 掛了誰重啟？
- 流量怎麼分到多個 container？
- 要 scale up，在哪台機器開新的？
- 舊版和新版怎麼 rolling update？

這些問題需要一個 orchestrator（負責排程、重啟、分配流量給 container 的系統）來處理。

---

## k8s：讓機器管機器

2014 年，Google 開源了 Kubernetes。它的前身是 Borg，Google 內部跑了十年的 container orchestrator。

k8s 不負責 build image。它接受一份狀態宣告，例如「要 3 個 replica」，**然後把實際狀態調整到跟宣告一樣，並持續維持。**

### 宣告式 vs 命令式

命令式（前面一直在做的）：

```bash
ssh server-1 "docker run -d --name app -p 8080:8080 my-app:v1.2"
ssh server-2 "docker run -d --name app -p 8080:8080 my-app:v1.2"
ssh server-3 "docker run -d --name app -p 8080:8080 my-app:v1.2"
```

三台 server，手動跑三次。其中一台失敗了？自己處理。

宣告式（k8s 的方式）：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: app
        image: my-app:v1.2
        ports:
        - containerPort: 8080
```

YAML 宣告「要 3 個 replica」。k8s 自己決定在哪三個 node 上跑。其中一個掛了？k8s 自動在另一個 node 上建新的。不需要任何人介入。

YAML 裡寫的「3 個 replica」叫 desired state，cluster 上實際在跑的叫 actual state。Controller 是 k8s 裡持續比對兩者的程式，發現不一樣就修正，這個動作叫 reconcile。

### Self-healing

Pod 掛了。k8s 的 controller 發現 actual replica = 2，desired replica = 3。差一個，所以它建一個新的。

Node 掛了。上面的所有 Pod 被標記為 lost。Controller 在其他 node 上重新建立它們。

開頭凌晨三點 SSH 進去重啟 process 那件工作，現在由 controller 自己處理。

### Service Discovery：內建的

之前用 Nginx 手動寫 upstream：

```nginx
upstream backend {
    server 10.0.1.5:8080;
    server 10.0.1.6:8080;
    server 10.0.1.7:8080;
}
```

Pod IP 是暫時的。Pod 重啟，新 IP。Scale up，新 IP。每次變動都要手動改這個列表，Pod 一多就改不完。

k8s 的 Service 是穩定的虛擬 IP（ClusterIP）。Pod A 呼叫 `my-service:8080`，kube-proxy 透過 iptables 規則把流量導到實際的 Pod。Pod 增減時規則自動更新。

呼叫方只需要知道 Service name。背後幾個 Pod、跑在哪裡，完全不用管。

### Rolling Update

更新到 v1.3：

```bash
kubectl set image deployment/my-app app=my-app:v1.3
```

k8s 慢慢建新的 v1.3 Pod，確認 healthy 後才殺舊的 v1.2 Pod。全程零停機。如果新版 Pod 一直 crash，rollout 停住，舊版繼續服務。

之前要自己寫 deploy script 處理 rolling update 邏輯。現在是內建的。

---

## k8s 解決了什麼，代價是什麼

### 解決了

| Before | After |
|---|---|
| 手動決定 container 跑在哪 | Scheduler 自動分配 |
| Container 掛了要人重啟 | Self-healing，自動重建 |
| 手動維護 Nginx upstream | Service Discovery 內建 |
| 自己寫 rolling update script | Rolling update 內建 |
| 每台 server 是 snowflake | Node 是可替換的，stateless |

### 代價

**大量的 YAML。**

一個 microservice 要部署到 k8s，至少需要六個 YAML：

- Deployment：定義 container、replica、resource limit
- Service：處理內部 DNS 跟 load balancing
- ConfigMap：放設定檔
- Secret：放密碼跟 API key
- Ingress：管外部流量入口
- HPA（Horizontal Pod Autoscaler）：設定自動 scale 的規則

三十個 microservice？180 個 YAML。

Dev、staging、prod 三個環境？這些 YAML 幾乎一樣，只差 image tag、replica count、env var。copy-paste 三份。

改了 dev 的 ConfigMap，忘了改 prod 的，週五一部署，prod 就出事了。

180 個 YAML 靠人手改，跟當年 SSH 進三十台 server 一樣，都是人在做重複的事。

### 更深的問題

`kubectl apply` 是誰跑的？工程師，手動。

誰確認 apply 的 YAML 跟 Git 裡的一樣？沒人。

有人 `kubectl edit` 手動改了 replica？Git 不知道。cluster 上的實際狀態跟 repo 裡的 YAML 已經 drift 了。

k8s 把部署自動化了，但 YAML 還是人寫的：180 個 YAML 檔案，每個環境手動改三行。

---

## 寫 YAML 跟跑 apply 的人工，後來怎麼拿掉

[Helm](chunk://helm) 把 YAML 模板化。一份模板 + 一份參數，產三個環境的 YAML。但模板複雜時比原始 YAML 更難讀。

[Terraform](chunk://terraform) 管的是 k8s cluster 本身。k8s 負責 container，VPC、subnet、node group、IAM 這些基礎設施不在 k8s 的 YAML 裡。Terraform 用宣告式的方式管理它們。

[GitOps](chunk://gitops) 讓人不用再手動跑 `kubectl apply`。ArgoCD 在 cluster 裡 watch Git repo，有新 commit 就自動 sync 到 cluster，所以 commit 進 Git 就等於部署。
