---
title: "Helm：YAML 的模板引擎，還是 Package Manager？"
slug: helm-deep
date: 2026-03-14
subtitle: "三個環境的 YAML 只差三行。但就是那三行害 production 出事。"
chapter: "devops"
tags: [helm, kustomize, k8s, devops, config-management]
related: [before-k8s, terraform-deep, deploy-practice]
---

# Helm：YAML 的模板引擎，還是 Package Manager？

有人改了 staging 的 ConfigMap，忘了同步 prod。三個環境的 YAML 只差三行。週五下午部署，prod 掛了。

一個中型服務大概有 60 個 YAML 檔案。乘以三個環境就是 180 份。每次改動要同步三個地方。漏一個就是一次 incident。這種重複性的同步工作不該由人來做。

---

## Before Helm：我們怎麼經歷過來的

### sed 替換

```bash
sed -i 's/IMAGE_TAG/v1.2.3/g' deployment.yaml
sed -i 's/REPLICA_COUNT/3/g' deployment.yaml
kubectl apply -f deployment.yaml
```

簡單場景下能用，但很脆弱。`IMAGE_TAG` 出現在 comment 裡也會被換掉，一個 typo 整份 YAML 就壞了，沒有型別檢查也沒有驗證。

### Copy-paste per env

```
manifests/
  dev/
    deployment.yaml
    service.yaml
    configmap.yaml
  staging/
    deployment.yaml   ← 跟 dev 的 99% 一樣
    service.yaml
    configmap.yaml
  prod/
    deployment.yaml   ← 跟 staging 的 99% 一樣
    service.yaml
    configmap.yaml
```

直覺歸直覺，這其實是最容易踩雷的做法。`diff dev/deployment.yaml prod/deployment.yaml`：

```diff
 apiVersion: apps/v1
 kind: Deployment
 metadata:
   name: my-app
 spec:
-  replicas: 1
+  replicas: 5
   template:
     spec:
       containers:
       - name: app
-        image: my-app:latest
+        image: my-app:v1.2.3
         env:
         - name: LOG_LEVEL
-          value: "debug"
+          value: "warn"
         - name: DB_HOST
-          value: "db-dev.internal"
+          value: "db-prod.internal"
```

30 行的 YAML，只差 4 行。但維護的是兩份完整的檔案。三個環境乘以 30 個 service，就是 90 份幾乎一樣的 YAML。

三個月後 dev 加了一個新的 env var，staging 和 prod 沒跟上。差異慢慢累積。這就是 configuration drift。跟雲端資源的 drift 無關，純粹是團隊自己檔案之間的 drift。

### 自己寫 script

```python
import yaml, sys

env = sys.argv[1]
config = yaml.safe_load(open(f"config/{env}.yaml"))
template = open("templates/deployment.yaml").read()
for key, value in config.items():
    template = template.replace(f"${{{key}}}", str(value))
print(template)
```

每個團隊都寫自己的版本，格式和邏輯各不相同。沒有共用的標準，換團隊就要重新理解一套新的 deploy script。

---

## Helm 的三個身份

### 身份一：模板引擎

Helm chart 的核心是 Go template。一份 `deployment.yaml` 不再是真正的 YAML，而是模板：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}-app
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
      - name: app
        image: {{ .Values.image.repository }}:{{ .Values.image.tag }}
        resources:
          limits:
            memory: {{ .Values.resources.limits.memory }}
        env:
        {{- range .Values.env }}
        - name: {{ .name }}
          value: {{ .value | quote }}
        {{- end }}
```

參數放在 `values.yaml`：

```yaml
replicaCount: 1
image:
  repository: my-app
  tag: v1.2.3
resources:
  limits:
    memory: 256Mi
env:
  - name: LOG_LEVEL
    value: debug
```

三個環境三份 values。`diff values-dev.yaml values-prod.yaml`：

```diff
-replicaCount: 1
+replicaCount: 5
 image:
   repository: my-app
-  tag: latest
+  tag: v1.2.3
 resources:
   limits:
-    memory: 256Mi
+    memory: 1Gi
 env:
   - name: LOG_LEVEL
-    value: debug
+    value: warn
+  - name: DB_HOST
+    value: db-prod.internal
```

差異集中在一個檔案裡，不再散落在 Deployment、Service、ConfigMap 各自的三份 copy 裡。改一行 values 就夠了，不用動三個地方的 YAML。

```bash
helm install my-app ./chart -f values-prod.yaml
```

### 身份二：Package Manager

要跑 Redis，可以自己寫 Deployment + Service + ConfigMap + PersistentVolumeClaim。或者一行解決：

```bash
helm install redis bitnami/redis
```

一行就裝好。Bitnami 的 chart 處理了所有細節：master-replica 架構、sentinel、persistence、resource limit、security context。

Helm chart 就像 npm package。公開 repo（Artifact Hub）有幾千個現成的 chart，不需要從頭寫每個第三方服務的部署設定。

### Chart 從 repo 到 cluster 的完整路徑

假設要在 EKS 裡裝一個 VPN gateway，供應商提供了 Helm chart。整個流程：

```bash
# 1. 加 repo, 告訴 Helm 去哪裡找 chart
helm repo add acme-vpn https://acme-vpn.github.io/helm-charts/
helm repo update
```

`repo add` 只是加書籤。`repo update` 去那個 URL 重新抓一次 `index.yaml`，也就是 chart 目錄。

```text
acme-vpn.github.io/helm-charts/
├── index.yaml                    ← Helm 讀這個
│     entries:
│       vpn-gateway:
│         - version: 2.1.0
│           urls: [vpn-gateway-2.1.0.tgz]
│
└── vpn-gateway-2.1.0.tgz        ← 壓縮包
      解壓 →  vpn-gateway/
              ├── Chart.yaml
              ├── values.yaml     ← chart 作者寫的預設值
              └── templates/
                  ├── deployment.yaml
                  ├── service.yaml
                  ├── serviceaccount.yaml
                  └── configmap.yaml
```

先看預設值有什麼：

```bash
helm show values acme-vpn/vpn-gateway
```

```yaml
replicaCount: 1
image:
  repository: acme/vpn-gateway
  tag: "latest"
serviceAccount:
  create: true
  name: "acme-vpn"
env:
  - name: LICENSE_KEY
    value:              # 空的，安裝時必須填
  - name: GATEWAY_ENDPOINT
    value:              # 空的，安裝時必須填
```

預設值故意留空。安裝時另建一份 `values.yaml`，只寫要覆蓋的部分：

```yaml
# my-values.yaml, 只寫差異
serviceAccount:
  create: false         # 用已經存在的 SA，不讓 chart 建新的
env:
  - name: LICENSE_KEY
    value: "xxxx-xxxx"
  - name: GATEWAY_ENDPOINT
    value: "gw.acme-vpn.com:443"
```

跟 CSS cascade 一樣。Chart 預設值是底層，`-f` 指定的檔案是覆蓋層。沒寫的欄位吃預設。

```bash
# 2. 安裝
helm upgrade -i dev-alice-vpn1 \
  -n acme-vpn \
  -f my-values.yaml \
  acme-vpn/vpn-gateway
```

| Flag | 意思 |
|---|---|
| `upgrade -i` | 有就升級，沒有就安裝 |
| `dev-alice-vpn1` | release name，自己取的名字 |
| `-n acme-vpn` | 裝到哪個 namespace |
| `-f my-values.yaml` | 覆蓋設定檔 |
| `acme-vpn/vpn-gateway` | repo / chart |

Helm 做的事：下載 tgz，解壓，把 chart 的 `values.yaml` 和 `my-values.yaml` 合併，塞進 Go template，產出完整的 K8s YAML，最後 apply 到 kubeconfig 指向的 cluster。

**Release name 隔離多人部署。** 同一個 namespace 裡可以有多個 release：

```bash
helm list -n acme-vpn

NAME               STATUS
dev-alice-vpn1    deployed
dev-bob-vpn1       deployed
dev-carol-vpn1     deployed
```

每個 release 是獨立的 Deployment、Pod、配置。升級或刪除 `dev-alice-vpn1` 不會影響其他人的 release。

### 身份三：Release Manager

每次 `helm install` 或 `helm upgrade` 產生一個 release，有版本號。

```bash
helm history my-app

REVISION  STATUS      DESCRIPTION
1         superseded  Install complete
2         superseded  Upgrade complete
3         deployed    Upgrade complete
```

出事了？

```bash
helm rollback my-app 2
```

回到第二版。Helm 用 k8s Secret 存每個 release 的 snapshot（rendered YAML），所以它知道每個版本長什麼樣。

---

## Template 的甜蜜點和斷裂點

### 簡單場景：清晰

```yaml
replicas: {{ .Values.replicaCount }}
```

一目了然。values 裡填數字就好。

### 中等場景：還行

```yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ .Release.Name }}-ingress
{{- end }}
```

用條件決定要不要 render 這段 YAML。例如 prod 需要 ingress，dev 不需要，一個 if 就搞定。

### 複雜場景：災難

```yaml
{{- if and .Values.ingress.enabled (not .Values.ingress.className) }}
  {{- if .Capabilities.APIVersions.Has "networking.k8s.io/v1" }}
apiVersion: networking.k8s.io/v1
  {{- else }}
apiVersion: networking.k8s.io/v1beta1
  {{- end }}
{{- end }}
{{- with .Values.ingress.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
{{- end }}
{{- range .Values.ingress.hosts }}
  - host: {{ .host | quote }}
    http:
      paths:
        {{- range .paths }}
        - path: {{ .path }}
          pathType: {{ .pathType | default "ImplementationSpecific" }}
        {{- end }}
{{- end }}
```

到這個程度，debug 的對象變成了 Go template。K8s 和 app 的問題還沒碰到，時間先花在模板上了。

這就跑錯一層了。工具該讓你專心解 app 怎麼部署，結果你卻在跟 template 的 indent 為什麼 render 錯纏鬥。

`helm template my-app ./chart` 可以在本地 render，方便檢查產出。但如果你常常要 debug render 結果，那大概就表示 template 已經太複雜了。

---

## [Kustomize](chunk://kustomize)：另一種哲學

Helm 的做法是寫模板、注入變數。Kustomize 的做法是寫真正的 YAML，再疊上差異。

### Base + Overlay

Base 資料夾放的是完整的 YAML，能直接 `kubectl apply`，不需要任何 render。

```yaml
# base/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: app
        image: my-app:latest
```

Overlay 只寫差異：

```yaml
# overlays/prod/patch-replicas.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 5
```

```yaml
# overlays/prod/kustomization.yaml
resources:
  - ../../base
patches:
  - path: patch-replicas.yaml
```

```bash
kubectl apply -k overlays/prod/
```

Kustomize 把 base + patch 合併。最終的效果等於這個 diff：

```diff
 apiVersion: apps/v1
 kind: Deployment
 metadata:
   name: my-app
 spec:
-  replicas: 1
+  replicas: 5
   template:
     spec:
       containers:
       - name: app
         image: my-app:latest
```

Overlay 只描述差異，Base 不被修改。這是增量運算：只存差異，要完整的就拿 base 加上差異算出來。

同樣的 pattern 在其他地方也能看到。Git commit 不存整份檔案，存的是 diff，parent commit 加上 diff 就是新 commit。React 的 virtual DOM 不重繪整個頁面，而是算出 diff，只更新變了的 DOM node。資料庫的 WAL 不每次寫完整 page，先寫 log entry，checkpoint 加上 log 就是當前 state。

Kustomize 的 overlay 就是 K8s 世界的 diff：base 加上 patch，等於最終 YAML。

### 跟 Helm 的本質差異

Helm 的 base 不是合法的 YAML。`{{ .Values.replicaCount }}` 是 Go template 語法，沒辦法直接 `kubectl apply`，必須先 render。

Kustomize 的 base 是合法的 YAML，任何人都讀得懂。Overlay 是 strategic merge patch，也是合法的 YAML。整個流程不離開 YAML 的世界。

### Kustomize 的弱點

Strategic merge patch 能處理大部分場景，但遇到 array 裡的特定元素就不行了。Deployment 的 containers 和 env 都是 array，strategic merge 只能按 `name` 欄位 merge container，沒辦法精確改某個 env var 的 value。這時候得退回 JSON patch：

```yaml
- op: replace
  path: /spec/template/spec/containers/0/env/2/value
  value: "new-value"
```

`/containers/0/env/2` 指的是第一個 container 的第三個 env var（index 從 0 開始）。問題是 index 寫死了。有人在前面加一個 env var，所有後面的 index 全部移位，patch 就指錯地方了。這在實務上確實會遇到，尤其是多人同時改 base 的時候。

---

## 不是二選一

實務上很多團隊兩個都用：

第三方服務用 Helm。Redis、Nginx Ingress、cert-manager 這些 chart 已經寫好了，用 values 客製化就行。自家 app 用 Kustomize。差異小，base 直接可讀，overlay 清楚。

甚至可以串接：

```bash
helm template my-chart ./chart -f values-prod.yaml | kubectl apply -k -
```

Helm render 出 YAML，餵給 Kustomize 再 patch。

---

## Helm 不管的事

Helm 管 k8s 裡面的東西：Deployment、Service、ConfigMap。

但 k8s cluster 本身呢？

VPC、Subnet、NAT Gateway、EKS cluster、Node Group、IAM Role、S3 Bucket、RDS。

這些都不是 k8s resource，`kubectl apply` 碰不到它們。它們是基礎設施，在 cluster 之下。

`helm install` 假設 cluster 已經存在。但誰負責讓它存在？

如果靠手動在 AWS Console 點，那跟手動 SSH 部署一樣：不可追蹤、不可重現、不可 review。

基礎設施也需要宣告式管理。也需要版本控制。也需要 diff + review + apply。

---

## 這篇沒講到的

**[Terraform](chunk://terraform)** 做宣告式 infra provisioning。描述 end state（S3 bucket、VPC、EKS cluster），Terraform 算 diff 並執行。但 state file 的管理是最大的負擔。

**[GitOps](chunk://gitops)** 解決的是「Helm release 由誰執行」的問題。目前是人跑 `helm upgrade`。GitOps 的答案是 commit 到 Git，ArgoCD 自動 sync。人只做 review，不做 apply。

這些是下兩篇的故事。
