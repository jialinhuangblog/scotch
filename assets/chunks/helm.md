---
title: "Helm"
slug: helm
brief: "基於 Go template 的 k8s package manager。解決 YAML 重複，犧牲可讀性換靈活性。"
date: 2026-03-14
article: helm-deep
---

# Helm

k8s 的 YAML 一多就開始重複：三個環境幾乎一樣的 deployment，光是改幾個值就要整份複製。Helm 把這些 YAML 做成模板，重複的部分只寫一次，會變的用參數帶進去。

## 三個身份

**模板引擎**

Go template 語法。一份 `deployment.yaml` 模板 + 一份 `values.yaml` 參數，產出最終的 YAML。三個環境三份 values，模板只寫一次。

```yaml
replicas: {{ .Values.replicaCount }}
image: {{ .Values.image.repository }}:{{ .Values.image.tag }}
```

**Package manager**

`helm install redis bitnami/redis`。像 npm，但裝的是一組 k8s 資源。公開 chart repo 有幾千個現成的 chart。

**Release manager**

每次 `helm install` 或 `helm upgrade` 產生一個 release。`helm rollback my-app 3` 回退到第三版。

## Tradeoff

模板簡單時很好讀，但一複雜，它會比原始 YAML 還難懂。這時你 debug 的常常是 Go template 語法而不是 k8s 本身，anyway 你就分心囉。

替代方案 **Kustomize** 不用模板，改用 overlay patch：base 是一份真正能跑的 YAML，各環境再疊一個 patch、只寫要改的欄位。對比同一件事（把 replicas 從 1 改成 3）：

```yaml
# Helm：base 先放佔位的參數，再用 values.yaml 填值
replicas: {{ .Values.replicaCount }}

# Kustomize：base 是完整的 YAML
# base/deployment.yaml
replicas: 1
# overlays/prod/patch.yaml：只寫要蓋掉的那行
replicas: 3
```

Helm 先挖好參數位置再填，Kustomize 直接拿完整 YAML 再 patch。兩者不互斥，很多團隊 Helm render 完再用 Kustomize patch。
