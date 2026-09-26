---
title: "Helm：YAML 的模板引擎，還是 Package Manager？"
slug: helm-deep
date: 2026-03-14
subtitle: "三個環境的 YAML 只差三行，有人改了其中一個環境、忘了同步另一個，production 就出事。"
chapter: "devops"
tags: [helm, kustomize, k8s, devops, config-management]
related: [before-k8s, terraform-deep, deploy-practice]
---

# Helm：YAML 的模板引擎，還是 Package Manager？

有人改了 staging 的 ConfigMap，忘了同步 prod。三個環境的 YAML 只差三行。週五下午部署，prod 掛了。

一個中型服務大概有 60 個 YAML 檔案。乘以三個環境就是 180 份。每次改動要同步三個地方，漏一個就是一次 incident。

---

## Before Helm：YAML 怎麼分環境

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

這個做法最直覺。`diff dev/deployment.yaml prod/deployment.yaml` 的結果是這樣：

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

## Helm 是什麼

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

Bitnami 的 chart 處理了所有細節：master-replica 架構、sentinel、persistence、resource limit、security context。

Helm chart 就像 npm package。公開 repo（Artifact Hub）有幾千個現成的 chart，不需要從頭寫每個第三方服務的部署設定。

### Chart 從 repo 到 cluster 的完整路徑

假設要在 EKS 裡裝一個 VPN gateway，供應商提供了 Helm chart。整個流程：

```bash
# 1. 加 repo, 告訴 Helm 去哪裡找 chart
helm repo add acme-vpn https://acme-vpn.github.io/helm-charts/
helm repo update
```

`repo add` 把這個 repo 的名字跟 URL 記下來，同時下載一份 `index.yaml`，也就是 chart 目錄，存進本機 cache。之後 repo 發布新版本，要跑 `repo update` 去那個 URL 重新抓一次 `index.yaml`，本機才會有新版本的紀錄。

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

跟 CSS cascade 一樣。Chart 預設值是底層，`-f` 指定的檔案是覆蓋層。沒寫的欄位用預設值。

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

這行指令會下載 tgz 並解壓，把 chart 的 `values.yaml` 跟 `my-values.yaml` 合併後代入 Go template 產出完整的 K8s YAML，最後 apply 到 kubeconfig 指向的 cluster。

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

## Template 寫到多複雜會難讀

### 簡單：只填一個值

```yaml
replicas: {{ .Values.replicaCount }}
```

一目了然。values 裡填數字就好。

### 中等：加一個條件

```yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ .Release.Name }}-ingress
{{- end }}
```

用條件決定要不要 render 這段 YAML。例如 prod 需要 ingress，dev 不需要，一個 if 就搞定。

### 複雜：條件、迴圈、版本判斷疊在一起

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

到這個程度，debug 的對象變成了 Go template。K8s 和 app 的問題還沒碰到，時間先花在查 indent 為什麼 render 錯上了。

`helm template my-app ./chart` 可以在本地 render，方便檢查產出。

---

## [Kustomize](chunk://kustomize)：不寫模板，只寫差異

Kustomize 不用模板。base 是能直接 apply 的 YAML，每個環境再疊上一小份差異。

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

Overlay 只描述差異，Base 不被修改，要完整的 YAML 就拿 base 加上差異算出來。這跟 Git 的 commit 很像，parent commit 加上 diff 就是新的 commit。

### 跟 Helm 的本質差異

Helm 的 base 不是合法的 YAML。`{{ .Values.replicaCount }}` 是 Go template 語法，沒辦法直接 `kubectl apply`，必須先 render。

Kustomize 的 base 是合法的 YAML，任何人都讀得懂。Overlay 是 strategic merge patch，也是合法的 YAML。

### Kustomize 的弱點

Strategic merge patch 能處理大部分場景，但 array 要有 merge key 才能精確修改其中一個元素。Deployment 的 containers 和 env 都有，按 `name` 欄位 merge，所以改某個 env var 的 value 沒問題。`args` 這種沒有 merge key 的 array 就不行，patch 會把整串 args 換掉。只想改其中一個參數，得退回 JSON patch：

```yaml
- op: replace
  path: /spec/template/spec/containers/0/args/2
  value: "--log-level=debug"
```

`/containers/0/args/2` 指的是第一個 container 的第三個 arg（index 從 0 開始）。問題是 index 寫死了。有人在前面加一個 arg，所有後面的 index 全部移位，patch 就指錯地方了。

---

## Helm 跟 Kustomize 一起用

兩個可以分工：

第三方服務用 Helm。Redis、Nginx Ingress、cert-manager 這些 chart 已經寫好了，用 values 客製化就行。自家 app 用 Kustomize，因為環境之間差異小，base 本身就能直接讀。

甚至可以串接：

```bash
helm template my-chart ./chart -f values-prod.yaml > overlays/prod/rendered.yaml
kubectl apply -k overlays/prod/
```

Helm render 出 YAML，交給 Kustomize 再 patch。`-k` 只接受目錄，不讀 stdin，所以 render 結果要先寫成檔案，再列進 `overlays/prod/kustomization.yaml` 的 `resources`。

---

## Helm 不處理的部分

Helm 管的是 k8s 裡的 resource，像 Deployment、Service、ConfigMap。

但 k8s cluster 本身呢？

VPC、Subnet、NAT Gateway、EKS cluster、Node Group、IAM Role、S3 Bucket、RDS。

這些都不是 k8s resource，`kubectl apply` 碰不到它們。它們是基礎設施，在 cluster 之下。

`helm install` 假設 cluster 已經存在。但誰負責讓它存在？

如果靠手動在 AWS Console 點，就回到手動 SSH 的老問題，誰改了什麼查不到，也沒辦法照著再建一次。所以基礎設施也要能進版本控制，先看 diff、review 過再 apply。

---

## cluster 誰來建，helm upgrade 誰來跑

**[Terraform](chunk://terraform)** 做宣告式 infra provisioning。描述 end state（S3 bucket、VPC、EKS cluster），Terraform 算 diff 並執行。但 state file 的管理是最大的負擔。

**[GitOps](chunk://gitops)** 解決的是「Helm release 由誰執行」的問題。目前是人跑 `helm upgrade`。GitOps 的答案是 commit 到 Git，ArgoCD 自動 sync。人只做 review，不做 apply。
