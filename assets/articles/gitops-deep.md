---
title: "GitOps：Git 是唯一的真相來源"
slug: gitops-deep
date: 2026-03-14
subtitle: "「prod 上是哪個版本？」這問題常常沒人答得出來，ArgoCD 卻一直清楚。"
chapter: "devops"
tags: [gitops, argocd, ci-cd, drift, sealed-secrets, devops]
related: [terraform-deep, before-k8s, deploy-practice, progressive-delivery]
---

# GitOps：Git 是唯一的真相來源

Team lead 問：「prod 上跑的是哪個版本？」

跑 `kubectl get deployment my-app -o jsonpath='{.spec.template.spec.containers[0].image}'`。回傳 `my-app:v1.4.2`。

但 Git repo 裡的 YAML 寫的是 `v1.4.1`。

有人 `kubectl set image` 手動更新了。沒有 commit。沒有 PR。沒有 review。prod 的實際狀態跟 Git 裡記錄的不一樣。

誰改的？為什麼改？改了什麼？沒有紀錄。

這就是 [drift](chunk://drift)。這裡指的是 k8s 的 drift（app 層），跟 Terraform 的 drift（infra 層）不同。

---

## Before GitOps：Push-based Deploy

傳統 [CI/CD](chunk://ci-cd) pipeline：

```
Developer merge PR
    → CI pipeline 觸發
    → Build Docker image
    → Push to container registry
    → helm upgrade my-app --set image.tag=v1.4.2
    → 部署完成
```

Pipeline **主動推**到 cluster。這叫 push-based deploy。

### Push 的問題

**Pipeline 需要 cluster credential。** CI runner 要拿到 kubeconfig 或 service account token 才能 `kubectl apply`。CI runner 被入侵 = cluster 被入侵，attack surface 很大。

**推完就不管了。** Pipeline 跑完，顯示 "Deploy succeeded"。但 pipeline 不會持續監控。有人手動改了 cluster，pipeline 不會發現。

**Git 和 cluster 可以 diverge。** Pipeline 推的是當時的 YAML。之後有人手動改了 cluster，Git 裡還是舊的。下次 pipeline 跑，會用 Git 裡的版本覆蓋手動改動。如果那個手動改動是 hotfix 呢？覆蓋了。沒人注意到。

### 根本問題

k8s 是 pull-based 的。Controller watch etcd，看到 desired state 變了就行動。這是 [reconciliation](chunk://reconciliation) loop，k8s 的核心設計。

但傳統 CI/CD 是 push-based 的。Pipeline 主動推。跟 k8s 的哲學不一致。

GitOps 把 deploy 也變成 pull-based。

---

## GitOps 的核心原則

四個原則：

**1. Git 是唯一的真相來源。** Cluster 狀態、CI pipeline 輸出、某個人的 terminal 都不算數。Git repo 裡的 YAML（或 [Helm](chunk://helm) values）= desired state。

**2. 所有變更都透過 Git。** 改 replica 就改 Git 裡的 YAML，發 PR，review，merge。不用 `kubectl edit`。不用 `helm upgrade --set`。

**3. Agent 在 cluster 裡 pull。** Agent（ArgoCD/Flux）跑在 cluster 裡，watch Git repo。Git 有新 commit → agent 偵測 diff → sync。Pipeline 不直接推到 cluster。

**4. 持續 reconciliation。** Agent 不是跑一次就停。它定期比較 Git 和 cluster。有 drift 就通知或自動修復。

---

## ArgoCD：k8s-native GitOps Controller

ArgoCD 跑在 cluster 裡，是一個 k8s controller。它 watch 的不是 etcd，是 Git repo。

### Application CRD

ArgoCD 的核心概念：

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  source:
    repoURL: https://github.com/my-org/k8s-manifests
    path: apps/my-service
    targetRevision: main
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

- `source`：指向 Git repo 的哪個 path
- `destination`：deploy 到哪個 cluster 的哪個 namespace
- `syncPolicy.automated.selfHeal: true`：有人手動改了 cluster，自動改回 Git 的版本

### Sync Loop

ArgoCD 每 3 分鐘（預設）拉一次 Git repo。也可以設 webhook，Git push 時即時通知 ArgoCD。

```
Git repo (desired) ←──── ArgoCD 比較 ────→ Cluster (actual)
                              ↓
                    有差異？Sync。沒差異？不動。
```

### Sync 狀態

- **Synced**：Git 和 cluster 一致。綠燈。
- **OutOfSync**：不一致。黃燈。可能是 Git 有新 commit 還沒 sync，也可能是有人手動改了 cluster。
- **Degraded**：sync 了但 resource 不健康（Pod CrashLoopBackOff）。紅燈。

### Drift Detection

這是 ArgoCD 跟傳統 CI/CD 最大的差異。

有人 `kubectl edit deployment my-app` 把 replica 從 3 改成 5。

傳統 CI/CD：不知道。直到下次 pipeline 跑，用 Git 的 YAML 覆蓋回 3。

ArgoCD：下次 sync loop 就發現 cluster 的 replica = 5 但 Git 寫 3。開了 `selfHeal` 就自動改回 3。沒開的話，UI 亮黃燈通知。

**Git 和 cluster 是否一致，隨時看得到。**

### Bootstrap：誰部署 ArgoCD？

ArgoCD 管所有部署，但它自己沒辦法部署自己。第一步是手動的。

```
1. helm install argocd        ← 手動，唯一一次碰 kubectl
2. kubectl apply root-app.yaml ← 手動建幾個「根」Application
3. ArgoCD 接管                ← 從這裡開始全自動
```

根 Application 指向 Git repo 裡放 Application 定義的目錄。ArgoCD 掃到目錄裡有新的 YAML，就自動建子 Application。子 Application 再各自 sync 真正的 workload。

### App of Apps

這個 pattern 讓整個 cluster 的部署只靠一棵樹驅動：

```
根 Application（手動建）
├── infra-apps    → 監聽 repo/applications/ 目錄
│   ├── fluentd   → helm/fluentd/ + values.yaml  → efk namespace
│   ├── istio     → helm/istio/                   → istio-system namespace
│   └── prometheus→ helm/prometheus/               → monitoring namespace
└── app-projects  → 監聽 repo/projects/ 目錄
    └── ...       → 管 ArgoCD Project 權限
```

手動只需要建最上面那幾個根 Application。之後在 Git repo 裡加一個 YAML 檔就等於加一個部署。刪掉 YAML 就等於下線。cluster 的狀態完全由 Git 決定。

### Helm + ArgoCD

ArgoCD 原生支援 Helm chart 作為 source。Application 的 `spec.source.helm` 指定 values 檔案：

```yaml
source:
  helm:
    releaseName: fluentd
    valueFiles:
      - values.yaml            # chart 預設值
      - dev-eks.yaml           # cluster 專屬覆蓋
  path: helm/fluentd
  repoURL: https://github.com/my-org/argocd
  targetRevision: main
```

ArgoCD 先讀 `values.yaml`，再用 `dev-eks.yaml` 覆蓋，render 出最終 manifest，apply 到 cluster。改 values 檔案 push 到 Git，ArgoCD 就會自動 re-render 並 sync。

---

## 完整的 Deploy 流程

### Before（手動時代）

```
Developer: 寫 code → push → 手動 build → scp 到 server → ssh 重啟
```

### Middle（CI/CD 但沒 GitOps）

```
Developer: merge PR
    → CI: build image, push to registry
    → CD: helm upgrade / kubectl apply（pipeline 推）
    → 推完就不管
```

### After（GitOps）

```
Developer: merge PR
    → CI: build image, push to registry, update values.yaml image tag, commit
    → ArgoCD: detect Git change → diff → sync to cluster
    → k8s: reconciliation loop → rolling update new pods
    → ArgoCD: 持續監控，有 drift 就通知/修復
```

人做的就只有 review 跟 merge PR，剩下交給自動化。

Build 是 CI 的事。Deploy 是 ArgoCD 的事。監控是 ArgoCD 的事。Recovery 是 k8s 的事。

### CI 和 CD 的分工

```
CI Pipeline（GitHub Actions）        ArgoCD（cluster 裡）
─────────────────────────           ──────────────────────
1. 拉 code                          1. Watch Git repo
2. 跑 test                          2. Detect new commit
3. Build Docker image                3. Diff Git vs cluster
4. Push image to registry            4. Sync（kubectl apply）
5. 更新 Git 裡的 image tag           5. 持續監控 drift
6. Commit & push
```

注意：CI pipeline **不碰 cluster**。它只 build image 和更新 Git。Deploy 是 ArgoCD 從 Git pull 的。

CI runner 不需要 kubeconfig。不需要 cluster credential。Attack surface 大幅縮小。

---

## Terraform 的 GitOps：Atlantis

ArgoCD 是 k8s 的 GitOps。Terraform 呢？

Atlantis 做類似的事：

1. Developer 發 PR，改了 `.tf` 檔
2. Atlantis bot 在 PR 裡自動跑 `terraform plan`
3. Plan 結果 comment 在 PR 上，reviewer 直接看 diff
4. Reviewer approve，comment `atlantis apply`
5. Atlantis 跑 `terraform apply`

```
PR comment:

Plan: 2 to add, 1 to change, 0 to destroy.

+ aws_s3_bucket.new_assets
~ aws_security_group.web (1 rule change)
```

跟 ArgoCD 的哲學一樣：人 review，機器執行。

但 Terraform GitOps 比 k8s GitOps 更危險。`terraform apply` 直接操作雲端 API，刪 VPC、改 IAM policy 都有可能。k8s 有 self-healing，Terraform 沒有。刪了就是刪了。所以大多數團隊用 manual apply（人在 PR 裡按按鈕），不用 auto-apply。

---

## Secret 怎麼辦

GitOps 要求所有東西都在 Git。但 Secret 不能明文放 Git。

### k8s Secret 不是加密

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
data:
  password: cGFzc3dvcmQxMjM=   # base64("password123")
```

Base64 不是加密。任何人 `echo cGFzc3dvcmQxMjM= | base64 -d` 就能看到明文。把這個 YAML 放 Git = 把密碼公開。

### 解法一：Sealed Secrets

Bitnami Sealed Secrets。Cluster 裡跑一個 controller，持有私鑰。

```bash
kubeseal --format yaml < secret.yaml > sealed-secret.yaml
```

產出加密的 SealedSecret YAML。放 Git。ArgoCD sync 到 cluster。Controller 用私鑰解密，產出真正的 k8s Secret。

只有 cluster 能解密。Git 裡的密文沒有私鑰就是亂碼。

### 解法二：External Secrets Operator

Secret 根本不存 Git。

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: db-credentials
spec:
  secretStoreRef:
    name: aws-secrets-manager
  target:
    name: db-credentials
  data:
  - secretKey: password
    remoteRef:
      key: production/db/password
```

ExternalSecret 是一個宣告：「去 AWS Secrets Manager 拿 `production/db/password`，建一個 k8s Secret。」

Git 裡只有指向 secret 的指標，不是 secret 本身。ArgoCD sync ExternalSecret → Operator 去 Secrets Manager 拉 → 建出 k8s Secret。

### 解法三：SOPS

Mozilla SOPS。用 AWS KMS 或 GCP KMS 加密 YAML 裡的 value（不是整個檔案）。

```yaml
password: ENC[AES256_GCM,data:abc123...,type:str]
```

ArgoCD 有 SOPS plugin。Sync 時自動解密。

---

## GitOps 的代價

### 學習曲線

一個 deploy 涉及四層工具：

```
Terraform → infra
Helm → k8s 資源模板
ArgoCD → GitOps sync
k8s → container runtime
```

出了問題，在哪一層？Terraform plan 失敗？Helm template render 錯了？ArgoCD sync 卡住？k8s Pod CrashLoopBackOff？

每一層都有自己的 debug 方式。新人要一次學四套工具。

### 延遲

Git push → ArgoCD detect → sync。預設 3 分鐘 polling，不是即時的。Webhook 能縮短，但不是零延遲。

急著 deploy hotfix 可以手動在 ArgoCD UI 按 sync。但這是 bypass GitOps 流程。如果 hotfix 沒 commit 到 Git，下次 sync 會被覆蓋回去。

### 回滾不是免費的

ArgoCD 沒有 `rollback` 按鈕（有，但不建議用）。正確的回滾方式：

1. `git revert` 那個 commit
2. Push
3. ArgoCD detect → sync → 部署舊版

這是 GitOps 的哲學：**所有變更都透過 Git。** 包括回滾。

### Repo 策略

App code 和 k8s manifest 放同一個 repo？還是分開？

**Monorepo** 把 code 和部署設定放在同一個 PR，簡單直覺。但 CI build 和 ArgoCD sync 綁在一起，code change 會觸發不必要的 sync。

**分開的 repo** 拆成 App repo（code + CI）和 Config repo（Helm values + [Kustomize](chunk://kustomize) overlay）。CI build 完 push image tag 到 Config repo，ArgoCD 只 watch Config repo。解耦乾淨，但兩個 repo 要協調。

大多數成熟的團隊用分開的 repo。

---

## 回看整條鏈

從第一篇走到這裡：

```
Before:  SSH → 手動部署 → 機器掛了人去修
         ↓
         痛：環境不一致、snowflake server
         ↓
Container: Docker 打包一切 → 環境問題解決
         ↓
         痛：十台機器誰管 container？
         ↓
k8s:     宣告式 + reconciliation → 機器管 container
         ↓
         痛：180 個 YAML，三個環境手動改
         ↓
Helm:    模板化 → YAML 重複問題解決
         ↓
         痛：cluster 本身誰建？infra 不是 YAML
         ↓
Terraform: 宣告式 infra → VPC/EKS/S3 都是 code
         ↓
         痛：誰跑 terraform apply？誰跑 helm upgrade？人。
         ↓
GitOps:  Git commit = deploy。ArgoCD pull + reconcile。
         人只做 review。機器做執行。
```

每個工具解決上一個的問題，也帶來自己的新問題。

沒有終點，但方向很清楚：把人從「執行」這一環抽出來，人負責決定，執行交給機器。

凌晨三點的電話，從 SSH 進去重啟 process，到 k8s self-healing 自動處理，到 ArgoCD 自動偵測 drift 並修復。到 ArgoCD 這一步，執行過程已經不需要人介入。

---

## 這篇沒講到的

**Progressive Delivery**，包括 Canary deploy、blue-green deploy、A/B testing。ArgoCD + Argo Rollouts 能做 canary：先把 5% 流量導到新版，metrics 正常再全量。

**Policy as Code**，例如 OPA/Gatekeeper。在 ArgoCD sync 之前檢查：「這個 Deployment 有沒有設 resource limit？有沒有用 latest tag？」不符合 policy 就擋住。

**Multi-cluster** 管理。ArgoCD 能管多個 cluster，一個 Application 部署到 dev、staging、prod 三個 cluster。ApplicationSet 自動化這件事。

這些是從這根主幹長出去的分支。
