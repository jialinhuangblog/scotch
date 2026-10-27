---
title: "Sealed Secrets"
slug: sealed-secrets
brief: "加密 secret 讓它能存進 Git。私鑰留在 cluster 裡，要另外備份。"
date: 2026-03-14
updated: 2026-10-18
revisions: 2
---

# Sealed Secrets

GitOps 要所有設定都進 Git，但 secret 明文又不能放進去，這兩個要求直接衝突。

## 問題

DB 密碼是 `s3cr3t`。寫成 k8s Secret，YAML 裡存的是 base64 之後的 `czNjcjN0`。base64 不是加密，任何人 clone repo 之後跑一行 `echo czNjcjN0 | base64 -d`，就看到 `s3cr3t`。把 Secret YAML 放進 Git，等於把密碼公開給所有有 repo 權限的人。

但如果 Secret 不在 Git，ArgoCD 怎麼 sync？手動 `kubectl create secret`？那就破壞了 GitOps「一切以 Git 為準」的初衷。

## Sealed Secrets 的解法

Bitnami Sealed Secrets 在 cluster 裡跑一個 controller。controller 產生一對金鑰，私鑰只留在 cluster，公鑰可以給任何人。

同一個密碼走一遍：

1. 工程師在自己電腦上用 `kubeseal` 加密。`kubeseal` 向 cluster 要公鑰，用公鑰把 `s3cr3t` 加密成一長串密文，產出一份 SealedSecret YAML。
2. SealedSecret YAML commit 進 Git。裡面只有密文，clone repo 的人看到的是亂碼，沒有私鑰解不開。
3. ArgoCD 把 SealedSecret sync 到 cluster。
4. cluster 裡的 controller 看到新的 SealedSecret，用私鑰解開，產出一個真正的 k8s Secret，裡面是 `s3cr3t`，app 照常掛載。

私鑰存在 cluster 裡的一個 Secret，Git 裡只有密文，所以 clone repo 的人解不開。換一個新 cluster，controller 會自己產生一把新的私鑰，Git 裡那些舊密文就打不開了。所以私鑰要另外備份：官方 README 給的指令是 `kubectl get secret -n kube-system -l sealedsecrets.bitnami.com/sealed-secrets-key -o yaml >main.key`，cluster 重建後，先 `kubectl apply -f main.key` 再啟動 controller。controller 預設每 30 天加一把新私鑰，舊的留著繼續解舊密文，但新的那把不在舊備份裡，所以每加一把就要重新備份一次。

## 其他做法

- **SOPS**：Mozilla 的加密工具，用 AWS KMS / GCP KMS / age / PGP 加密 YAML 裡的 value。不限 k8s，格式跟金鑰來源最彈性，代價是設定較複雜。
- **External Secrets Operator（ESO）**：從 Vault / AWS Secrets Manager 動態拉 secret 同步成 k8s Secret，不存 Git。能自動輪替、接多個 provider。
- **HashiCorp Vault**：集中式 secret 管理，走 API 存取。

小團隊、單純情境，Sealed Secrets 最省事；有規模、要自動輪替又要接外部 secret store，ESO 是目前更主流的做法。
