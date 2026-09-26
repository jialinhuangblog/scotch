---
title: "Pod ready doesn't mean user traffic goes to it"
slug: progressive-delivery
date: 2026-04-02
subtitle: "Rolling update 把 Pod 換完了。但 app 有 logic bug，error rate 從 0.1% 變 5%，直到隔天早上才有人回報。"
chapter: "devops"
tags: [progressive-delivery, canary, blue-green, argo-rollouts, argocd, devops]
related: [deploy-practice, gitops-deep]
---

# Pod ready doesn't mean user traffic goes to it

[上一篇](article://deploy-practice)從 merge PR 一路走到 Pod 跑起來。ArgoCD sync、Helm render 之後，k8s rolling update 把五個 replica 逐一換成新版，ArgoCD 亮綠燈。

隔天早上 Slack 開始有人回報，error rate 從 0.1% 跳到 5%。新版有個 edge case，某個 API 在特定 payload 下回 500。readiness probe 檢查的是 `/healthz`，不是這支 API，所以 probe 照樣通過，rolling update 也照常把五個 Pod 全換掉了。

Rolling update 的規則是新 Pod ready 就砍掉一個舊 Pod，而 ready 的意思是 readiness probe 通過。但 probe 只檢查 Pod 活著沒有，檢查不到業務邏輯對不對。

progressive delivery 補的是這一段，做法是讓新版先只收一小部分流量，metrics 正常才繼續加大比例。

---

## Rolling Update 做了什麼，沒做什麼

```
Deployment replicas=5, image: v1 → v2

1. 建 1 個 v2 Pod
2. readiness probe 通過
3. v2 Pod 加入 Service endpoint
4. 砍 1 個 v1 Pod
5. 重複直到 5 個都是 v2
```

整個過程大概幾十秒到幾分鐘。k8s 的 `maxSurge` 和 `maxUnavailable` 控制一次換幾個，但不管怎麼調，核心邏輯不變：probe 過了就換。

Rolling update 缺少這幾個機制：

- **流量百分比控制。** 新 Pod ready 就收流量，比例由 Pod 數量決定，沒辦法指定「先 5% 就好」。
- **Metrics gate。** 沒有機制觀察 error rate 或 latency，再決定要不要繼續。
- **自動 rollback。** probe 失敗會停住，但 probe 過了之後的業務問題不會觸發回滾。

---

## Canary：先放一小部分流量給新版

[Canary](chunk://canary-deploy) 的概念來自礦坑裡的金絲雀。礦工帶金絲雀下坑，金絲雀先死，礦工就知道有毒氣。

Canary deployment 的邏輯一樣：先讓一小群 user 碰到新版。新版有問題，只有這一小群受影響。

### 流量怎麼切

k8s 原生的 Service 把流量平均分到所有 Pod。kube-proxy 預設的 iptables 模式每條連線隨機挑一個 Pod，IPVS 模式預設是 round-robin，兩種長期下來都是平均分。5 個 Pod 裡 1 個是新版，流量比例就是 20%，沒辦法設成 5%。

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

Istio 在每個 Pod 裡放一個 Envoy sidecar proxy，由它攔截流量，95% 送到 stable Pod，5% 送到 canary Pod。這是 [L7 層的流量控制](chunk://l4-vs-l7-lb)。

**不用 Istio 的替代方案：** Nginx Ingress Controller 也支援 canary annotation。或者用 AWS ALB 的 weighted target group。但 Istio 是最常見的搭配，因為 [Argo Rollouts](chunk://argo-rollouts) 原生整合了 Istio。

### 手動 canary 的問題

手動做 canary：部署新版 Pod，改 VirtualService weight，盯 dashboard 五分鐘，改 weight，再盯五分鐘。凌晨三點的 hotfix 也要有人盯。

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

`steps` 列出 rollout 的每一步。`setWeight: 5` 讓 Argo Rollouts 去改 Istio VirtualService 的 weight，把 5% 流量導到 canary Pod。`pause` 等 5 分鐘。然後 20%、50%、100%。

中間不需要有人盯著 dashboard 手動改 weight。

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

但 pause 5 分鐘之後呢？要是沒人看 dashboard，pause 一結束就會繼續放量（把新版的流量比例往上調），那跟沒做 canary 差不多。

AnalysisRun 是 Argo Rollouts 的 metrics gate。它在每個 pause 階段自動查詢 Prometheus（或 Datadog、New Relic），再依結果決定要繼續放量還是 rollback。

### AnalysisTemplate

AnalysisTemplate 是查詢模板，Rollout 用名字引用它：

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

`successCondition: result[0] < 0.01` 代表 5xx rate 低於 1% 就算通過，`interval: 1m` 則是每分鐘查詢一次。

### 在 Rollout 裡加上 Analysis

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

整個 rollout 從部署到接下全部流量可能花 15-20 分鐘，比 rolling update 慢很多。但新版有問題時最多只影響 5% 的 user，而且不用等人反應就會自動回滾。

### Analysis 失敗時發生什麼

Rollouts controller 把 canary Pod 砍掉，VirtualService weight 切回 100% stable。Rollout 狀態變成 `Degraded`。ArgoCD UI 會顯示紅燈。

同時可以接 Slack notification：AnalysisRun failed，rollback 完成，附上 Prometheus 查詢結果。oncall 早上看到的是已經回滾完的通知，而不是一個還在進行、等人處理的 incident。

---

## Blue-Green：一次切換全部流量

Canary 是一點一點放量，[Blue-green](chunk://blue-green-deploy) 則是一次把流量全部切過去。

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

出事了就把 activeService 切回 Blue。Blue 的 Pod 都還在，所以回滾只要幾秒。

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

內部 service、非核心功能，或測試覆蓋率夠高的 service，用 rolling update 就夠了。部署快，也不需要額外工具。

要是 readiness probe 設計得好（檢查 DB 連線、dependency health），大部分部署問題在 probe 那一步就會停住。

### Canary

面對 user、出事會影響營收的路徑，像 payment、checkout、login，光是 probe 通過不夠，要看到 metrics 正常才放心放量。

前提是 observability 要夠好。Canary 的 metrics gate 查詢的是 Prometheus，要是 Prometheus 上根本沒有 error rate metric，gate 就沒有數字可以判斷。

### Blue-Green

適合需要瞬間回滾的系統，比如法規要求回滾時間在 N 秒內的金融系統。migration 很大、要完整跑完 smoke test 才能切的情況也適合。

代價是資源成本。如果 prod 跑 50 個 Pod，blue-green 部署期間就是 100 個。

### 決策路徑

先用 rolling update，等到第一次有部署造成的 production incident，再開始導入 canary。先在最關鍵的 1-2 個 service 上加 Argo Rollouts，設 canary steps + AnalysisRun。其他 service 繼續用 rolling update。

每個 service 都上 canary 的成本在工具維護（Argo Rollouts + Istio + Prometheus 整合），不只是設定一個 YAML。每個 service 的 AnalysisTemplate 要調：什麼 metric、什麼 threshold、多長的觀察窗口。調錯了，要嘛太敏感一直誤判 rollback，要嘛太鬆跟沒設一樣。

blue-green 的優勢在回滾速度，canary 的優勢在「根本不需要回滾全量，因為只有 5% 的 user 碰到新版」。

上了 canary 之後，要是 AnalysisRun 一直通過（因為 metric 設太鬆），production 卻還是出問題，那問題出在 observability，不在 canary。回頭補 metrics 比換部署策略有效。

---

## 回看整條鏈

```
Rolling Update（k8s 內建）
  → probe 過了就換，沒有 metrics gate
  → 問題：probe 不等於業務正確

Canary（Argo Rollouts）
  → 先放一點流量，metrics 正常再加
  → 問題：需要 Istio + Prometheus + 調 threshold

Blue-Green（Argo Rollouts）
  → 兩套環境，瞬間切換
  → 問題：資源翻倍 + DB migration 很難處理
```

CD 把新版推上 cluster 之後，流量怎麼放給新版，由 progressive delivery 控制。

---

## Feature flag、Flagger、Git 狀態對不上

**Feature Flag。** Canary 在 infra 層控制流量，feature flag 在 app 層控制功能，兩者都是讓新東西先只碰到一部分 user。兩個可以一起用：canary 控制誰碰到新版 binary，feature flag 控制新版 binary 裡的哪些功能打開。

**Flagger。** 另一個 progressive delivery controller，跟 Argo Rollouts 競爭。Flagger 用 Kubernetes 原生的 Deployment 跟 HPA（Horizontal Pod Autoscaler），不需要新的 CRD。Argo Rollouts 用自己的 Rollout CRD，功能更完整，但現有的 Deployment 要改寫成 Rollout。

**GitOps + Progressive Delivery 的 Git 狀態問題。** Canary 進行中，Git 裡的 image tag 已經是新版，但 cluster 上只有 5% 流量在新版。ArgoCD 會認為 Synced，但實際上 rollout 還沒結束。這個狀態 gap 需要理解 ArgoCD 和 Rollouts 的分工才能 debug。
