---
title: "Terraform"
slug: terraform
brief: "宣告式基礎設施佈建。Provider 模型跨雲。State file 記錄實際有哪些資源，弄丟了 Terraform 會想全部重建。"
date: 2026-03-14
article: terraform-deep
---

# Terraform

描述好 end state，怎麼到達由 Terraform 算。

## 核心模型

```hcl
resource "aws_s3_bucket" "assets" {
  bucket = "my-assets"
}
```

這是一句宣告：「該有一個叫 my-assets 的 S3 bucket。」

- `terraform plan`：比較 .tf 檔和 state file，算出 diff。
- `terraform apply`：執行那份 diff，去建立、修改或刪除資源。

## Provider

Terraform 不直接呼叫 AWS，中間隔著一層 provider。AWS provider 負責呼叫 AWS API，GCP provider 負責呼叫 GCP API。

同一個 `terraform apply` 能同時管理 AWS 的 S3 和 Cloudflare 的 DNS。能同時管理多家雲，是因為中間有 provider 這一層，負責把 Terraform 的宣告翻譯成各家雲自己的 API 呼叫。

## 代價

State file。Terraform 靠它記住「現在實際有哪些資源」。這份 state 一旦弄丟，Terraform 就會以為那些資源都不存在，然後想把它們整個重建一遍。這是 Terraform 最脆弱的部分。
