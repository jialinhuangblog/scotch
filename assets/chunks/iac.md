---
title: "Infrastructure as Code"
slug: iac
brief: "用版本控制的設定管理基礎設施，取代手動點擊。告別 ClickOps。"
date: 2026-03-14
article: terraform-deep
---

# Infrastructure as Code

用 code 管你的基礎設施，不要靠在 Console 上手點。

## ClickOps 的問題

在 AWS Console 點按鈕建一個 S3 bucket。過幾個月再看到它，你大概說不出它當初為什麼建、還有沒有在用、能不能刪掉。

手動操作不可追蹤、不可重現、不可 review。只要有人手一滑點錯 checkbox，production 的安全就可能出包。

## IaC 的核心

把 infra 定義寫成檔案（HCL、YAML、JSON），放進 Git。建立、修改、刪除 infra 都透過 code change + review + apply。

好處：
- **版本控制**：誰改了什麼、什麼時候、為什麼
- **可重現**：同一份 code 能建出一模一樣的環境
- **可 review**：PR review infra 變更，跟 review code 一樣

工具：Terraform（多雲）、CloudFormation（AWS 限定）、Pulumi（用程式語言寫）。
