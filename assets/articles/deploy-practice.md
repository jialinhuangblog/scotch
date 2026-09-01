---
title: "After you merge a PR, what happens before the Pod actually runs?"
slug: deploy-practice
date: 2026-03-15
subtitle: "Docker、Helm、Terraform、ArgoCD 接成一條 pipeline，從 push 到 Pod 跑起來實際長什麼樣。"
chapter: "devops"
tags: [gitops, argocd, helm, ci-cd, k8s, devops, deploy]
related: [gitops-deep, helm-deep, before-k8s, progressive-delivery]
---

# After you merge a PR, what happens before the Pod actually runs?

前面四篇各自講了 Docker、Helm、Terraform、ArgoCD 的「為什麼」和「tradeoff」。但實際部署一個 app 時，這四個工具怎麼接在一起？設定長什麼樣？出事了在哪一層 debug？

這篇用一個具體的例子走完整條路：一個前端 + 兩個後端，從 `git push` 到三個環境的 Pod 跑起來。

---

## 架構：三個 service，三個環境

```text
frontend (React)
    ↓ HTTP
api-server (Node.js)
    ↓ gRPC
user-service (Go)
```

三個環境：dev、staging、prod。每個環境一個 namespace。

```text
dev     → namespace: myapp-dev      (1 replica each)
staging → namespace: myapp-staging  (2 replicas each)
prod    → namespace: myapp-prod     (5 replicas each)
```

---

## Repo 結構：Code 和 Config 分開

大部分成熟的團隊把 app code 和 k8s config 放在不同的 repo。

```text
app-repo (code + CI)
├── frontend/
│   ├── src/
│   ├── Dockerfile
│   └── ...
├── api-server/
│   ├── src/
│   ├── Dockerfile
│   └── ...
├── user-service/
│   ├── main.go
│   ├── Dockerfile
│   └── ...
└── .github/workflows/
    └── ci.yaml          ← CI: build image, push to registry

config-repo (k8s manifests + Helm)
├── charts/
│   ├── frontend/
│   │   ├── Chart.yaml
│   │   ├── values.yaml          ← 基礎預設值
│   │   ├── values-dev.yaml      ← dev 覆蓋
│   │   ├── values-staging.yaml  ← staging 覆蓋
│   │   ├── values-prod.yaml     ← prod 覆蓋
│   │   └── templates/
│   │       ├── deployment.yaml
│   │       └── service.yaml
│   ├── api-server/
│   │   └── ...
│   └── user-service/
│       └── ...
└── argocd/
    ├── frontend-dev.yaml
    ├── frontend-staging.yaml
    ├── frontend-prod.yaml
    └── ...
```

分開的好處：CI build image 不會觸發 ArgoCD sync。ArgoCD 只 watch config-repo。兩邊各自獨立。

---

## Helm：三層 values 覆蓋

Helm chart 的 `values.yaml` 是基礎預設值。每個環境再疊一層覆蓋。

### 基礎值（values.yaml）

```yaml
replicaCount: 1

image:
  repository: myregistry.io/frontend
  tag: latest

service:
  type: ClusterIP
  port: 80

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi

env:
  - name: API_URL
    value: "http://api-server:8080"
```

### Dev 覆蓋（values-dev.yaml）

```yaml
replicaCount: 1

image:
  tag: "dev-abc1234"

env:
  - name: API_URL
    value: "http://api-server:8080"
  - name: LOG_LEVEL
    value: "debug"
```

### Prod 覆蓋（values-prod.yaml）

```yaml
replicaCount: 5

image:
  tag: "v2.1.0"

resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    cpu: "2"
    memory: 1Gi

env:
  - name: API_URL
    value: "http://api-server:8080"
  - name: LOG_LEVEL
    value: "warn"
```

更進階的場景會加第三層：region 覆蓋。

```yaml
# values-prod-us.yaml
env:
  - name: CDN_ORIGIN
    value: "https://cdn-us.example.com"

# values-prod-asia.yaml
env:
  - name: CDN_ORIGIN
    value: "https://cdn-asia.example.com"
```

ArgoCD 裡指定多個 valueFiles，後面的覆蓋前面的：

```yaml
helm:
  valueFiles:
    - values.yaml           # 基礎
    - values-prod.yaml       # 環境
    - values-prod-us.yaml    # 地區
```

---

## Deployment YAML 裡的 label 為什麼寫三次

Helm template 裡的 Deployment 長這樣：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  labels:
    app: frontend          # ① Deployment 本身的標籤
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app: frontend        # ② 告訴 Deployment「管哪些 Pod」
  template:
    metadata:
      labels:
        app: frontend      # ③ Pod 被建立時會帶的標籤
    spec:
      containers:
      - name: frontend
        image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
```

三個 `app: frontend` 各有用途：

| 位置 | 誰讀 | 用途 |
|---|---|---|
| ① `metadata.labels` | 人、kubectl | 方便 `kubectl get deploy -l app=frontend` 篩選 |
| ② `spec.selector.matchLabels` | Deployment controller | 「我負責管 label 符合這個條件的 Pod」 |
| ③ `template.metadata.labels` | Pod 本身 | Pod 被建出來後帶著這個 label，讓 ② 能配對到 |

② 和 ③ 必須一致，不然 Deployment 找不到自己建的 Pod。Service 也用同樣的 label 來找 Pod：

```yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend
spec:
  selector:
    app: frontend          # 找 label 是 app=frontend 的 Pod
  ports:
  - port: 80
    targetPort: 3000
```

Deployment 用 label 管 Pod，Service 用 label 找 Pod。Label 是 k8s 裡所有東西互相認識的方式。

---

## Service DNS：完整的名稱解析

Pod 裡呼叫另一個 Service 時，只寫 Service name 就能連到：

```typescript
const response = await fetch("http://api-server:8080/users");
```

k8s 的 CoreDNS 會把 `api-server` 解析成完整的 FQDN：

```text
api-server
  → api-server.myapp-prod.svc.cluster.local
  → ClusterIP (10.96.1.25)
  → kube-proxy iptables 轉到實際的 Pod IP
```

| 簡寫 | 完整 FQDN | 什麼時候用 |
|---|---|---|
| `api-server` | `api-server.myapp-prod.svc.cluster.local` | 同 namespace 內 |
| `api-server.myapp-staging` | `api-server.myapp-staging.svc.cluster.local` | 跨 namespace |

同 namespace 裡寫短名就好。跨 namespace 要加 namespace name。`svc.cluster.local` 通常不用寫，CoreDNS 的 search domain 會自動補。

---

## ArgoCD Application：三個維度控制監控範圍

每個 service 的每個環境，對應一個 ArgoCD Application：

```yaml
# argocd/frontend-prod.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: frontend-prod
  namespace: argocd
spec:
  source:
    repoURL: https://github.com/myorg/config-repo    # 哪個 repo
    targetRevision: main                               # 哪個 branch
    path: charts/frontend                              # 哪個目錄
    helm:
      valueFiles:
        - values.yaml
        - values-prod.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: myapp-prod
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

三個維度決定 ArgoCD 監控什麼：

| 維度 | 設定 | 意思 |
|---|---|---|
| `repoURL` | 哪個 Git repo | config-repo，不是 app-repo |
| `targetRevision` | 哪個 branch/tag | main, develop, release/v2.1 |
| `path` | 哪個目錄 | charts/frontend（不會監控 charts/api-server） |

`helm.valueFiles` 決定的是「監控到變更後，怎麼回應」。path 底下任何檔案變了都會觸發 sync，但 render 時只用指定的 valueFiles。

### 環境區分的三種方法

**方法一：同一個 repo + branch，不同的 ArgoCD Application**

```yaml
# frontend-dev.yaml
spec:
  source:
    path: charts/frontend
    helm:
      valueFiles: [values.yaml, values-dev.yaml]
  destination:
    namespace: myapp-dev

# frontend-prod.yaml
spec:
  source:
    path: charts/frontend
    helm:
      valueFiles: [values.yaml, values-prod.yaml]
  destination:
    namespace: myapp-prod
```

`charts/frontend/` 有任何變更，兩個環境都會 sync。但各自用不同的 values，render 出來的 YAML 不同。適合小團隊，config 都在 main branch。

**方法二：不同的 branch**

```yaml
# dev 監控 develop branch
spec:
  source:
    targetRevision: develop
    helm:
      valueFiles: [values.yaml, values-dev.yaml]

# prod 監控 main branch
spec:
  source:
    targetRevision: main
    helm:
      valueFiles: [values.yaml, values-prod.yaml]
```

develop branch 的變更只觸發 dev。merge 到 main 才觸發 prod。多了一層 branch 隔離。

**方法三：不同的 repo**

```yaml
# dev
spec:
  source:
    repoURL: https://github.com/myorg/config-dev

# prod
spec:
  source:
    repoURL: https://github.com/myorg/config-prod
```

完全隔離。適合對 prod 變更需要嚴格管控的場景。

---

## 完整 workflow：從 merge PR 到 Pod 更新

開發者改了 frontend 的 code，push，發 PR，merge。接下來全自動。

### Step 1：CI build image

```yaml
# app-repo/.github/workflows/ci.yaml
name: CI
on:
  push:
    branches: [main]
    paths: ['frontend/**']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build and push image
        run: |
          docker build -t myregistry.io/frontend:${{ github.sha }} frontend/
          docker push myregistry.io/frontend:${{ github.sha }}

      - name: Update config repo
        run: |
          git clone https://github.com/myorg/config-repo
          cd config-repo
          sed -i "s|tag:.*|tag: \"${{ github.sha }}\"|" charts/frontend/values-prod.yaml
          git add .
          git commit -m "ci: update frontend image to ${{ github.sha }}"
          git push
```

CI 做兩件事：build + push image，然後更新 config-repo 的 image tag。CI 不碰 cluster，不需要 kubeconfig。

### Step 2：ArgoCD 偵測 config-repo 變更

```text
ArgoCD (每 3 分鐘 poll，或 webhook 即時通知)
  ↓ 偵測 charts/frontend/values-prod.yaml 有新 commit
  ↓ helm template charts/frontend -f values.yaml -f values-prod.yaml
  ↓ 比較 rendered YAML 和 cluster 上的實際狀態
  ↓ 有 diff（image tag 變了）
  ↓ sync
```

### Step 3：K8s rolling update

```text
Deployment frontend (prod)
  ↓ image 從 v2.0.9 → abc1234
  ↓ 建新的 Pod（abc1234）
  ↓ 等 readiness probe 通過
  ↓ 把舊 Pod（v2.0.9）標記 terminating
  ↓ 等 graceful shutdown
  ↓ 刪除舊 Pod
  ↓ 重複直到所有 5 個 replica 都更新
```

全程零停機。如果新 Pod 的 readiness probe 一直沒過，rollout 停住，舊版繼續服務。

### Step 4：ArgoCD 持續監控

```text
Sync 完成後：
  ↓ 狀態 = Synced + Healthy（綠燈）
  ↓ 每 3 分鐘比較 Git vs cluster
  ↓ 有人 kubectl edit 改了 replica？
  ↓ selfHeal: true → 自動改回 Git 的值
```

---

## 出事了在哪一層 debug

四個工具串在一起，出問題時第一步是判斷在哪一層：

| 現象 | 在哪一層 | 怎麼查 |
|---|---|---|
| CI 沒跑 | CI（GitHub Actions） | 看 Actions log |
| Image push 失敗 | CI → Registry | `docker pull` 試試看 |
| ArgoCD 顯示 OutOfSync | ArgoCD | ArgoCD UI 看 diff |
| ArgoCD sync 失敗 | Helm template render | `helm template` 本地跑看 error |
| Pod CrashLoopBackOff | K8s / App | `kubectl logs`、`kubectl describe pod` |
| Pod Running 但連不到 | Service / Network | `kubectl get endpoints`、確認 label match |
| Cluster 建不起來 | Terraform | `terraform plan` 看 error |

最常見的錯誤：
- Image tag 打錯，Pod pull image 失敗 → `ImagePullBackOff`
- values.yaml 的 indent 錯了，Helm render 出不合法的 YAML → ArgoCD sync failed
- Service 的 selector label 跟 Pod 的 label 對不上 → endpoint 是空的，連線 timeout

---

## 這篇沒講到的

**Progressive Delivery**：先放 5% 流量到新版，metrics 正常再慢慢放大，不一次全換。ArgoCD + Argo Rollouts 能做 canary deploy。

**Secret 管理**：這篇的 values.yaml 裡沒有放 secret。實務上密碼和 API key 要用 Sealed Secrets 或 External Secrets Operator，不能明文放 Git。gitops-deep 那篇有講。

**Multi-cluster**：這篇假設所有環境在同一個 cluster 的不同 namespace。大型組織會用不同的 cluster。ArgoCD 的 ApplicationSet 能自動化跨 cluster 部署。
