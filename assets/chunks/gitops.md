---
title: "GitOps"
slug: gitops
brief: "cluster 的狀態以 Git 為準。cluster 內的 agent 從 Git 拉取變更並套用，pipeline 不用 push 部署。"
date: 2026-03-14
updated: 2026-10-18
revisions: 2
article: gitops-deep
---

# GitOps

cluster 該是什麼狀態，以 Git 裡的 manifest 為準。要改 cluster，就改 Git。

## Push vs Pull

傳統 CI/CD 是 push：pipeline build 完 image，自己拿著 cluster 的 kubeconfig 跑 `helm upgrade` 或 `kubectl apply`。cluster 的 credential 放在 CI 的 secret 裡。

GitOps 是 pull。走一次上版：工程師把 `deploy/api.yaml` 的 image tag 從 `api:1.4` 改成 `api:1.5`，開 PR，merge 進 main。cluster 裡跑著一個 agent（ArgoCD 或 Flux），每隔幾分鐘 fetch 一次這個 repo，看到 main 多了一個 commit，把 manifest 渲染出來跟 cluster 現在的 Deployment 比，差一個 image tag，就 apply 上去。pipeline 只負責 build image 跟 push 到 registry，從頭到尾沒碰過 cluster。

## 為什麼 Pull 更好

1. **安全**：CI 的 secret 裡沒有 kubeconfig。CI 被入侵，攻擊者拿到的是 registry 的推送權限，沒辦法直接對 cluster 下 `kubectl`。但他還是能把自己的 image 推成 `api:1.5`，蓋掉原本那個 tag。之後有 Pod 排到一台還沒拉過這個 image 的新 node，那台 node 就會拉到攻擊者的版本來跑。要防止這件事，registry 得把 tag 設成不可覆寫（例如 ECR 的 immutable tag），或者 manifest 裡用 digest（`api@sha256:...`）釘住 image，不寫 tag。
2. **Drift detection**：agent 每一輪都在比「cluster 現在長怎樣」跟「Git 說該長怎樣」。半夜有人 `kubectl scale deploy api --replicas=5` 救火，Git 裡寫的是 3，下一輪 agent 比對看到 5 比 3，把這個 app 標成 OutOfSync，可以發警告。ArgoCD 光開 auto-sync 不會改回來，因為 auto-sync 只在 Git 的內容變了才同步，cluster 上的手動修改不會觸發它。要再開 selfHeal，ArgoCD 才會把 cluster 改回 3。這個落差叫 drift，沒有 agent 的話要到下次部署才有人發現。
3. **跟 k8s 哲學一致**：k8s 本身就是 reconciliation loop，GitOps 只是把 desired state 的來源從 etcd 延伸到 Git。

## 工具

ArgoCD 跟 Flux 是最常見的兩個 GitOps controller，兩個都跑在 cluster 裡 watch Git 並做 reconciliation。ArgoCD 內建 UI dashboard。Flux 本身沒有內建 UI，主要用 CLI 操作，要圖形介面得另外裝 Capacitor 這類工具。
