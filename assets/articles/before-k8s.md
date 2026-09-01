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

打開筆電，SSH 進去，看 log，發現 OOM。手動重啟 process。等三分鐘，確認恢復了。回去睡覺。

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

這叫 snowflake server。每台都是雪花，獨一無二，不可重現。

沒人敢碰。沒人敢重建。因為沒人知道這台機器上到底裝了什麼。

### 部署的恐懼

在這個世界裡，部署是危險的。每次部署都可能因為環境差異而失敗。所以團隊開始減少部署頻率。一週一次。兩週一次。一個月一次。

部署越少，累積下來的變更就越大，越容易出事，於是更不敢部署。這個循環會把自己越拖越深。

---

## Container：打包一切

2013 年，Docker 出現了。它解決了一個問題：「在我機器上沒問題。」

### 之前

App 依賴 Node.js 18、libssl 1.1、一個特定版本的 imagemagick。本機全裝好了，跑得很順。

推到 server 上，Node.js 是 16，libssl 是 3.0，imagemagick 沒裝。壞了。

花兩小時對環境。一台一台裝。下次部署，又有新的依賴，又要對。

### 之後

```dockerfile
FROM node:18-alpine
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["node", "server.js"]
```

`docker build` 把 app + 所有 dependency 打包成一個 image。Image 是不可變的。本機跑得起來，production 跑起來是一模一樣的東西。

不再對環境。不再 snowflake。Image 就是 artifact，跟編譯出來的 binary 一樣確定。

### Container 的本質

Container 不是虛擬機。沒有 guest OS，沒有 hypervisor。它就是一個 Linux process，但被兩個 kernel 功能限制了：

Namespaces 隔離視野。Container 裡的 process 看到的 PID 從 1 開始，看不到 host 的檔案系統，有自己的網路 stack。它以為自己是整台電腦。實際上它只是一個被騙的 process。

Cgroups 限制資源。CPU 最多用 0.5 核。記憶體最多 256MB。超過就 OOM kill。

兩個加起來：隔離 + 限制 = container。啟動時間是毫秒級，不像虛擬機需要分鐘級，因為不需要啟動 OS。

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

這些問題需要一個 orchestrator 來管。

---

## k8s：讓機器管機器

2014 年，Google 開源了 Kubernetes。它的前身是 Borg，Google 內部跑了十年的 container orchestrator。

k8s 不幫忙 build image，不幫忙寫 code。它做一件事：**接受狀態宣告，負責達成和維持。**

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

這就是 desired state。宣告目標，controller 持續 reconcile actual state 到 desired state。

### Self-healing

Pod 掛了。k8s 的 controller 發現 actual replica = 2，desired replica = 3。差一個。它建一個新的。

Node 掛了。上面的所有 Pod 被標記為 lost。Controller 在其他 node 上重新建立它們。

沒有半夜的電話，也不用手動進去重啟，機器自己搞定。

### Service Discovery：內建的

之前用 Nginx 手動寫 upstream：

```nginx
upstream backend {
    server 10.0.1.5:8080;
    server 10.0.1.6:8080;
    server 10.0.1.7:8080;
}
```

Pod IP 是暫時的。Pod 重啟，新 IP。Scale up，新 IP。手動維護這個列表？不可能。

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

**YAML。大量的 YAML。**

一個 microservice 要部署到 k8s，至少需要六個 YAML：Deployment 定義 container、replica、resource limit。Service 處理內部 DNS 和 load balancing。ConfigMap 放設定檔。Secret 放密碼和 API key。Ingress 管外部流量入口。HPA 設定自動 scale 規則。

三十個 microservice？180 個 YAML。

Dev、staging、prod 三個環境？這些 YAML 幾乎一樣，只差 image tag、replica count、env var。copy-paste 三份。

改了 dev 的 ConfigMap，忘了改 prod 的。週五部署，prod 爆了。

**YAML 多起來就 hold 不住，本質上跟手動 SSH 一樣累，只是從管 server 變成管一堆檔案。**

### 更深的問題

`kubectl apply` 是誰跑的？工程師，手動。

誰確認 apply 的 YAML 跟 Git 裡的一樣？沒人。

有人 `kubectl edit` 手動改了 replica？Git 不知道。cluster 上的實際狀態跟 repo 裡的 YAML 已經 drift 了。

k8s 把「部署」從人的工作變成機器的工作。但「描述部署」仍然是人的工作。180 個 YAML 檔案，每個環境手動改三行。

一定有更好的方式。

---

## 這篇沒講到的

[Helm](chunk://helm) 把 YAML 模板化。一份模板 + 一份參數，產三個環境的 YAML。但模板複雜時比原始 YAML 更難讀。

[Terraform](chunk://terraform) 管的是 k8s cluster 本身。k8s 管 container，但 VPC、subnet、node group、IAM 不是 YAML，是基礎設施。Terraform 用宣告式的方式管它們。

[GitOps](chunk://gitops) 把 `kubectl apply` 從人手裡拿走。Git commit = 部署。ArgoCD 在 cluster 裡 watch Git，自動 sync。

每一個都是下一篇的故事。
