---
title: "Service Mesh"
slug: service-mesh
brief: "Envoy sidecar。mTLS、重試、circuit breaking — 不用改 app code。"
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

**Circuit breaking。** Service B 開始掛了，sidecar 超過閾值就停止送流量。防止連鎖崩潰。冷卻後自動重開測試恢復。

**Observability。** 每個 request 經過 proxy，自動拿到 metrics（延遲、error rate、吞吐）、distributed tracing header、access log — 不用在應用程式碼埋點。

**流量控制。** Canary deployment、A/B routing、header-based routing。把 5% 流量切到新版，一看到 error rate 上去就 rollback。

## 代價

**延遲。** 每次呼叫多兩跳（來源 sidecar、目的 sidecar）。通常共 1-3ms，大部分 service 這點延遲無所謂，但你要是在搞超低延遲的東西就不行。

**營運複雜度。** Mesh 本身需要 control plane（Istio、Linkerd）。又多一套系統要部署、監控、debug。policy 一設錯，流量可能默默就不見了，你還看不到是哪裡出問題。

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

只要有一條 ALLOW 政策，沒被列進去的就一律擋掉。frontend 拼錯沒對上，它的呼叫全被拒，但 app 這邊不會跳錯，只看到流量莫名變少，得去翻 sidecar 的 log 才查得到。

**資源成本。** 每個 pod 一個 Envoy sidecar。50MB × 1000 pods = 50GB 記憶體只給 proxy。

## 什麼時候值得

service 不多就別上，shared library 更簡單。等 service 多起來、安全跟 observability 開始拖慢每個團隊，mesh 才值得。與其數 service 數量，不如看維護這些重複東西的成本有沒有超過 mesh 的麻煩。
