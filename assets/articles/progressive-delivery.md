---
title: "Pod ready doesn't mean user traffic goes to it"
slug: progressive-delivery
date: 2026-04-02
subtitle: "Rolling update 把 Pod 換完了。但 app 有 logic bug，error rate 從 0.1% 變 5%。沒人發現，因為沒人在看。"
chapter: "devops"
tags: [progressive-delivery, canary, blue-green, argo-rollouts, argocd, devops]
related: [deploy-practice, gitops-deep]
---

# Pod ready doesn't mean user traffic goes to it

deploy-practice 那篇走完了從 merge PR 到 Pod 跑起來的全流程。ArgoCD sync，Helm render，k8s rolling update，五個 replica 逐一換成新版。綠燈。

隔天早上 Slack 炸了。Error rate 從 0.1% 跳到 5%。新版有個 edge case，某個 API 在特定 payload 下回 500。readiness probe 檢查的是 `/healthz`，不是這支 API。probe 過了，rolling update 照常跑完，五個 Pod 全換了。

Rolling update 的合約很簡單：新 Pod ready 就換，舊 Pod 砍掉。「ready」的定義是 readiness probe 通過。但 probe 只能檢查 Pod 活不活，檢查不了 app 的業務邏輯對不對。

這個 gap 就是 progressive delivery 要填的。

---

## Rolling Update 做了什麼，沒做什麼

回顧一下 rolling update 的步驟：

```
Deployment replicas=5, image: v1 → v2

1. 建 1 個 v2 Pod
2. readiness probe 通過
3. v2 Pod 加入 Service endpoint
4. 砍 1 個 v1 Pod
5. 重複直到 5 個都是 v2
```

整個過程大概幾十秒到幾分鐘。k8s 的 `maxSurge` 和 `maxUnavailable` 控制一次換幾個，但不管怎麼調，核心邏輯不變：probe 過了就換。

Rolling update 沒有的東西：

- **流量百分比控制。** 新 Pod ready 就收流量，比例由 Pod 數量決定，沒辦法指定「先 5% 就好」。
- **Metrics gate。** 沒有機制觀察 error rate 或 latency，再決定要不要繼續。
- **自動 rollback。** probe 失敗會停住，但 probe 過了之後的業務問題不會觸發回滾。

這三個缺口加起來，就是「部署成功但上線失敗」的根源。

---

## Canary：先放一點流量試水溫

[Canary](chunk://canary-deploy) 的概念來自礦坑裡的金絲雀。礦工帶金絲雀下坑，金絲雀先死，礦工就知道有毒氣。

Canary deployment 的邏輯一樣：先讓一小群 user 碰到新版。新版有問題，只有這一小群受影響。

### 流量怎麼切

k8s 原生的 Service 用 round-robin 分流量到所有 Pod。5 個 Pod 裡 1 個是新版，流量比例就是 20%，沒辦法設成 5%。

要做精確的百分比切分，需要在 Service 之上加一層：

**Istio VirtualService：**

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
spec:
  http:
    - route:
        - destination:
            host: my-app
            subset: stable
          weight: 95
        - destination:
            host: my-app
            subset: canary
          weight: 5
```

Envoy sidecar 攔截流量，95% 送到 stable Pod，5% 送到 canary Pod。這是 [L7 層的流量控制](chunk://l4-vs-l7)。

**不用 Istio 的替代方案：** Nginx Ingress Controller 也支援 canary annotation。或者用 AWS ALB 的 weighted target group。但 Istio 是最常見的搭配，因為 [Argo Rollouts](chunk://argo-rollouts) 原生整合了 Istio。

### 手動 canary 的問題

手動做 canary：部署新版 Pod，改 VirtualService weight，盯 dashboard 五分鐘，改 weight，再盯五分鐘。凌晨三點的 hotfix 也要有人盯。

這就是 Argo Rollouts 要解決的事。

---

## Argo Rollouts：自動化 progressive delivery

Argo Rollouts 是一個 k8s CRD + controller。它引入一個新的 resource type：`Rollout`，用來取代 `Deployment`。

### Rollout CRD

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: my-app
spec:
  replicas: 5
  strategy:
    canary:
      canaryService: my-app-canary
      stableService: my-app-stable
      trafficRouting:
        istio:
          virtualService:
            name: my-app-vsvc
            routes:
              - primary
      steps:
        - setWeight: 5
        - pause: { duration: 5m }
        - setWeight: 20
        - pause: { duration: 5m }
        - setWeight: 50
        - pause: { duration: 10m }
        - setWeight: 100
  template:
    spec:
      containers:
        - name: my-app
          image: myregistry.io/my-app:v2
```

`steps` 定義了整個 rollout 的節奏。`setWeight: 5` 讓 Argo Rollouts 去改 Istio VirtualService 的 weight，把 5% 流量導到 canary Pod。`pause` 等 5 分鐘。然後 20%、50%、100%。

全程自動。沒人需要盯 dashboard 改 weight。

### 跟 ArgoCD 怎麼接

ArgoCD 負責把 Rollout YAML 從 Git sync 到 cluster。Argo Rollouts controller 負責執行 canary steps。

```
Git (Rollout YAML)
  → ArgoCD sync → kubectl apply Rollout
  → Rollouts controller 接手
  → setWeight 5 → pause → setWeight 20 → ...
```

ArgoCD 的工作在 `kubectl apply` 就結束了。之後的流量控制、pause、rollback 都是 Rollouts controller 的事，兩邊不會互相干擾。

---

## AnalysisRun：讓 metrics 決定要不要繼續

pause 5 分鐘，然後呢？如果沒人看 dashboard，pause 結束就自動繼續放量。跟沒有 canary 差不多。

AnalysisRun 是 Argo Rollouts 的 metrics gate。在每個 pause 階段自動查 Prometheus（或 Datadog、New Relic），根據查詢結果決定：繼續，還是 rollback。

### AnalysisTemplate

先定義一個查詢模板：

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: error-rate-check
spec:
  args:
    - name: service-name
  metrics:
    - name: error-rate
      interval: 1m
      successCondition: result[0] < 0.01
      provider:
        prometheus:
          address: http://prometheus:9090
          query: |
            sum(rate(http_requests_total{service="{{args.service-name}}",status=~"5.."}[5m]))
            /
            sum(rate(http_requests_total{service="{{args.service-name}}"}[5m]))
```

`successCondition: result[0] < 0.01` 意思是：5xx rate 低於 1% 就算通過。每分鐘查一次。

### 在 Rollout 裡掛 Analysis

```yaml
steps:
  - setWeight: 5
  - pause: { duration: 2m }
  - analysis:
      templates:
        - templateName: error-rate-check
      args:
        - name: service-name
          value: my-app
  - setWeight: 20
  - pause: { duration: 2m }
  - analysis:
      templates:
        - templateName: error-rate-check
      args:
        - name: service-name
          value: my-app
  - setWeight: 100
```

流程變成：

```
setWeight 5
  → pause 2 分鐘（讓流量穩定）
  → AnalysisRun 開始查 Prometheus
  → error rate < 1%？
    → 是 → 繼續 setWeight 20
    → 否 → 自動 rollback，流量全切回 stable
```

整個 rollout 從部署到全量可能花 15-20 分鐘。比 rolling update 慢很多。但那 15 分鐘買到的是：如果新版有問題，最多只有 5% 的 user 受影響，而且自動回滾，不用等人反應。

### Analysis 失敗時發生什麼

Rollouts controller 把 canary Pod 砍掉，VirtualService weight 切回 100% stable。Rollout 狀態變成 `Degraded`。ArgoCD UI 會顯示紅燈。

同時可以接 Slack notification：AnalysisRun failed，rollback 完成，附上 Prometheus 查詢結果。oncall 早上看到的是「已經修好」的結果，而不是一團還在燒、要他處理的火。

---

## Blue-Green：瞬間切換，瞬間回滾

Canary 是漸進的。[Blue-green](chunk://blue-green-deploy) 是全有全無。

### 運作方式

同時跑兩套完整的 Pod 群組。Blue 是 production，Green 是新版。

```
Blue (v1): 5 Pods ← activeService 指向這裡（100% 流量）
Green (v2): 5 Pods ← previewService 指向這裡（內部測試用）
```

Green 部署完成後，跑 smoke test。通過了，把 activeService 切到 Green。

```
Blue (v1): 5 Pods ← 沒流量，但還活著
Green (v2): 5 Pods ← activeService 指向這裡（100% 流量）
```

出事了？把 activeService 切回 Blue。秒級回滾。Blue 的 Pod 還在，不用重新部署。

### Argo Rollouts 的 Blue-Green 設定

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
spec:
  strategy:
    blueGreen:
      activeService: my-app-active
      previewService: my-app-preview
      autoPromotionEnabled: false
      prePromotionAnalysis:
        templates:
          - templateName: smoke-test
      scaleDownDelaySeconds: 600
```

`autoPromotionEnabled: false` 代表 Green 部署完不會自動切流量，要手動 promote 或等 prePromotionAnalysis 通過。`scaleDownDelaySeconds: 600` 讓舊版 Pod 多活 10 分鐘，確認新版穩定再砍。

### 代價

部署期間資源翻倍。5 個 Pod 的 service，blue-green 就是 10 個。跑完切換、確認穩定後才能砍舊版。

更大的問題是資料庫 migration。Blue 和 Green 共用同一個 DB。如果 Green 跑了 schema migration（加欄位、改型態），切回 Blue 的時候，Blue 的 code 可能讀不懂新 schema。所以 blue-green 搭配 DB migration 必須遵守 expand-and-contract pattern：先加新欄位（Green 和 Blue 都能跑），再慢慢清舊欄位。

---

## 什麼時候用哪種

### Rolling Update

大多數 service 用這個就夠了。內部 service、非核心功能、有充足測試覆蓋率的 service。部署快，不需要額外工具。

如果 readiness probe 設計得好（檢查 DB 連線、dependency health），rolling update 已經能擋掉大部分部署問題。

### Canary

面對 user 的 service。Payment、checkout、login 這種出事影響營收的路徑。需要 metrics-driven 的信心，不只是 probe 通過。

前提是要有夠好的 observability。Canary 的 metrics gate 查 Prometheus，如果 Prometheus 上沒有 error rate metric，canary 就是裝飾品。

### Blue-Green

需要瞬間回滾能力的場景。比如有法規要求回滾時間必須在 N 秒內的金融系統。或者 migration 很大，需要完整跑完 smoke test 再切的情境。

代價是資源成本。如果 prod 跑 50 個 Pod，blue-green 部署期間就是 100 個。這多出來的一倍資源，雲端帳單上看得很清楚。

### 決策路徑

大部分團隊從 rolling update 開始。第一次 production incident 是部署造成的，開始討論 canary。先在最關鍵的 1-2 個 service 上加 Argo Rollouts，設 canary steps + AnalysisRun。其他 service 繼續用 rolling update。

全面 canary 的團隊很少。成本在工具維護（Argo Rollouts + Istio + Prometheus 整合），不只是設定一個 YAML。每個 service 的 AnalysisTemplate 要調：什麼 metric、什麼 threshold、多長的觀察窗口。調錯了，要嘛太敏感一直誤判 rollback，要嘛太鬆跟沒設一樣。

blue-green 更少見。多數團隊覺得 canary 的漸進式放量比瞬間切換更安全。blue-green 的優勢在回滾速度，但 canary 的優勢在「根本不需要回滾全量，因為只有 5% 的 user 碰到新版」。

Regret condition：上了 canary 之後，如果 AnalysisRun 一直通過（因為 metric 設太鬆）但 production 還是出問題，問題不在 canary，在 observability。回頭補 metrics 比換部署策略有效。

---

## 回看整條鏈

```
Rolling Update（k8s 內建）
  → probe 過了就換，沒有 metrics gate
  → 痛：probe 不等於業務正確

Canary（Argo Rollouts）
  → 先放一點流量，metrics 正常再加
  → 痛：需要 Istio + Prometheus + 調 threshold

Blue-Green（Argo Rollouts）
  → 兩套環境，瞬間切換
  → 痛：資源翻倍 + DB migration 很難搞
```

Progressive delivery 不是取代 CD。CD 負責把新版推上 cluster，progressive delivery 負責控制推上去之後的流量。

---

## 這篇沒講到的

**Feature Flag。** 跟 canary 的目的重疊但層級不同。Canary 在 infra 層控制流量，feature flag 在 app 層控制功能。兩個可以疊著用：canary 控制誰碰到新版 binary，feature flag 控制新版 binary 裡的哪些功能打開。

**Flagger。** 另一個 progressive delivery controller，跟 Argo Rollouts 競爭。Flagger 用 Kubernetes 原生的 Deployment + HPA，不需要新的 CRD。Argo Rollouts 用自己的 Rollout CRD，功能更完整但侵入性更高。

**GitOps + Progressive Delivery 的 Git 狀態問題。** Canary 進行中，Git 裡的 image tag 已經是新版，但 cluster 上只有 5% 流量在新版。ArgoCD 會認為 Synced，但實際上 rollout 還沒結束。這個狀態 gap 需要理解 ArgoCD 和 Rollouts 的分工才能 debug。
