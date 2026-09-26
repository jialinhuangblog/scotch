---
title: "Service Mesh"
slug: service-mesh
brief: "Envoy sidecar。mTLS、重試、circuit breaking，不用改 app code。"
date: 2026-03-09
---

# Service Mesh

每個 microservice 都要 retry、timeout、mTLS、observability。要嘛每個 service 自己寫，要嘛把這些交給網路層做。

## Sidecar 模式

一個 proxy（通常是 Envoy）跟每個 service instance 並排跑。所有流量經過它。應用程式不知道它存在。

```
Service A → Envoy sidecar → 網路 → Envoy sidecar → Service B
```

Sidecar 處理 TLS termination、retry、circuit breaking、metrics 收集。應用程式只管對 `localhost` 發 HTTP。

## 拿到什麼

**mTLS 全覆蓋。** Mesh 自動簽發和輪替憑證。每個 service-to-service call 都加密且認證。不用改應用程式碼。

**Circuit breaking。** Service B 開始掛了，sidecar 超過閾值就停止送流量。防止連鎖崩潰。過一段時間後，sidecar 會先放少量請求過去，確認 B 恢復了才恢復流量。

**Observability。** 每個 request 經過 proxy，自動拿到 metrics（延遲、error rate、吞吐）、distributed tracing header、access log，不用在應用程式碼埋點。

**流量控制。** Canary deployment、A/B routing、header-based routing。把 5% 流量導到新版，一看到 error rate 上升就 rollback。

## 代價

**延遲。** 每次呼叫多兩跳（來源 sidecar、目的 sidecar），通常加起來 1-3ms。大部分 service 不在意這點延遲，但要求毫秒級回應的服務，多這 1-3ms 就太多了。

**營運複雜度。** Mesh 本身需要 control plane（Istio、Linkerd），又多一套系統要部署、監控、debug。policy 一設錯，流量可能默默就不見了，而且很難查出是哪裡出問題。

```yaml
# Istio AuthorizationPolicy，apply 到 mesh 上、套在某個 service 前面
kind: AuthorizationPolicy
spec:
  action: ALLOW
  rules:
    - from:
        - source:
            principals: ["…/sa/fronend"]   # 少一個 t，應該是 frontend
```

只要有一條 ALLOW 政策，沒被列進去的就一律拒絕。frontend 拼錯沒對上，它的呼叫全被拒，但 app 這邊不會跳錯，只看到流量莫名變少，得去翻 sidecar 的 log 才查得到。

**資源成本。** 每個 pod 一個 Envoy sidecar。50MB × 1000 pods = 50GB 記憶體只給 proxy。

## 什麼時候值得

十個 service 都用 Go 寫的話，retry、timeout 放進一個 shared library，每個 service import 就好，升級時改一個地方。同樣十個 service，要是分成 Go、Java、Node 三種語言，同一套 retry 邏輯得寫三份、各自升級，mTLS 的憑證輪替也要每個 service 自己接。這時候把這些交給 sidecar，比維護三份 library 省事，即使每個 pod 要多吃一個 Envoy 的記憶體。
