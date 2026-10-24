---
title: "CI/CD"
slug: ci-cd
brief: "CI 負責建置和測試，CD 負責發布。"
date: 2026-03-14
updated: 2026-10-18
revisions: 2
article: gitops-deep
---

# CI/CD

CI 在每次 push 時 build 跟跑 test。CD 把通過的 artifact 部署到 production。

## Continuous Integration

工程師推一個 commit 到 PR 分支，CI server 收到 Git 的 webhook，開一台乾淨的機器，依序跑：

1. Pull code
2. Install dependencies
3. Run tests
4. Build artifact（Docker image、binary）

跑到第 3 步，一個單元測試在第 6 分鐘 fail，pipeline 停住，PR 頁面出現紅叉，merge 按鈕鎖住。這個 bug 在 PR 階段就被看到，不會等上了 production 才發現。測試都過、PR merge 進 main 之後，main 上多出一個新的 commit，sha 是 `3f9c2e1`。不管按的是 merge commit 還是 squash，main 上這個 sha 都跟 PR 分支上那個不一樣，所以 CI 對 main 的這個 commit 再跑一次，這次跑到第 4 步，build 出 image，tag 用 main 上的 sha，`api:3f9c2e1`，推到 registry。main 上每個 commit 一個 image，之後要回滾，就是把 tag 換回 main 上前一個 sha。

## Continuous Delivery vs Continuous Deployment

`api:3f9c2e1` 進了 registry 之後，兩種做法分開。

**Delivery** — artifact 準備好了，但要人按按鈕才部署。pipeline 停在「等核准」，值班的人看過 staging 再按。
**Deployment** — artifact 準備好了，自動部署。merge 進 main 之後 15 分鐘，`api:3f9c2e1` 已經在 production 接流量，中間沒有人看過。

Continuous Deployment 沒有人工把關，test 沒抓到的 bug 會直接上 production，所以 test 要寫得夠完整才敢這樣做。

## Pipeline 工具

GitHub Actions、GitLab CI、Jenkins、CircleCI 的流程都是監聽 Git event → 跑一系列 step → 產出 artifact。

## 跟 GitOps 的關係

傳統 CI/CD：pipeline 最後一步直接 `kubectl apply` 或 `helm upgrade`，把 `api:3f9c2e1` 推上 cluster。
GitOps 分工：CI pipeline 只負責 build + push image，再把 manifest repo 裡的 image tag 從 `api:a81d0b7` 改成 `api:3f9c2e1`，commit 進去。ArgoCD 看到 manifest 變了，才把它 apply 到 cluster。
