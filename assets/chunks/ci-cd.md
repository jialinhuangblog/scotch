---
title: "CI/CD"
slug: ci-cd
brief: "CI 負責建置和測試，CD 負責發布。Pipeline 是自動化的骨幹。"
date: 2026-03-14
article: gitops-deep
---

# CI/CD

CI 確保 code 能 build。CD 確保 code 到得了 production。

## Continuous Integration

每次 push 或 merge：
1. Pull code
2. Install dependencies
3. Run tests
4. Build artifact（Docker image、binary）

CI 就是要早點抓到壞掉的東西，讓 test 在 PR 階段就 fail，別等上了 production 才發現問題。

## Continuous Delivery vs Continuous Deployment

**Delivery** — artifact 準備好了，但要人按按鈕才部署。
**Deployment** — artifact 準備好了，自動部署。

大多數團隊做 Delivery。真正的 Continuous Deployment 需要極高的測試信心。

## Pipeline 工具

GitHub Actions、GitLab CI、Jenkins、CircleCI。都做同一件事：監聽 Git event → 跑一系列 step → 產出 artifact。

## 跟 GitOps 的關係

傳統 CI/CD：pipeline 負責 build + deploy。
GitOps 分工：CI pipeline 只負責 build + push image + 更新 Git manifest。ArgoCD 負責把東西放上 cluster，pipeline 只到更新 manifest 為止。
