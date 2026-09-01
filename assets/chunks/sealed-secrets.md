---
title: "Sealed Secrets"
slug: sealed-secrets
brief: "加密 secret 讓它能存進 Git。只有 cluster 內能解密。解決 secret 不能進版控的問題。"
date: 2026-03-14
---

# Sealed Secrets

GitOps 要所有東西都進 Git，但 secret 明文又不能放進去，這兩個要求直接衝突。

## 問題

k8s Secret 是 base64 encoded，不是加密。任何人 clone repo 就能 decode。把 Secret YAML 放 Git = 把密碼公開。

但如果 Secret 不在 Git，ArgoCD 怎麼 sync？手動 `kubectl create secret`？那就破壞了 GitOps「一切以 Git 為準」的初衷，不能這樣。

## Sealed Secrets 的解法

Bitnami Sealed Secrets：在 cluster 裡跑一個 controller，持有私鑰。

1. 你用 `kubeseal` CLI 加密 Secret → 產出 SealedSecret YAML
2. SealedSecret 是加密的，可以安全放 Git
3. ArgoCD sync SealedSecret 到 cluster
4. Cluster 裡的 controller 用私鑰解密 → 產出真正的 k8s Secret

只有 cluster 能解密。Git 裡的密文沒有私鑰就是亂碼。

## 其他做法

- **SOPS**：Mozilla 的加密工具，用 AWS KMS / GCP KMS / age / PGP 加密 YAML 裡的 value。不限 k8s，格式跟金鑰來源最彈性，代價是設定較複雜。
- **External Secrets Operator（ESO）**：從 Vault / AWS Secrets Manager 動態拉 secret 同步成 k8s Secret，不存 Git。能自動輪替、接多個 provider。
- **HashiCorp Vault**：集中式 secret 管理，走 API 存取。

這幾個都是正經的選擇，不是「不得已的替代品」。小團隊、單純情境，Sealed Secrets 最省事；有規模、要自動輪替又要接外部 secret store，ESO 是目前更主流的做法。
