---
title: "CI/CD"
slug: ci-cd
brief: "CI 負責建置和測試，CD 負責發布。"
date: 2026-03-14
article: gitops-deep
---

# CI/CD

CI 在每次 push 時 build 跟跑 test。CD 把通過的 artifact 部署到 production。

## Continuous Integration

每次 push 或 merge：
1. Pull code
2. Install dependencies
3. Run tests
4. Build artifact（Docker image、binary）

CI 要早點抓到壞掉的 build 跟 test，讓 test 在 PR 階段就 fail，別等上了 production 才發現問題。

## Continuous Delivery vs Continuous Deployment

**Delivery** — artifact 準備好了，但要人按按鈕才部署。
**Deployment** — artifact 準備好了，自動部署。

Continuous Deployment 沒有人工把關，test 沒抓到的 bug 會直接上 production，所以 test 要寫得夠完整才敢這樣做。

## Pipeline 工具

GitHub Actions、GitLab CI、Jenkins、CircleCI 的流程都是監聽 Git event → 跑一系列 step → 產出 artifact。

## 跟 GitOps 的關係

傳統 CI/CD：pipeline 負責 build + deploy。
GitOps 分工：CI pipeline 只負責 build + push image + 更新 Git manifest。ArgoCD 負責把 manifest apply 到 cluster。
