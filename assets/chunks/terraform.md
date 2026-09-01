---
title: "Terraform"
slug: terraform
brief: "宣告式基礎設施佈建。Provider 模型跨雲。State file 是它的優勢也是弱點。"
date: 2026-03-14
article: terraform-deep
---

# Terraform

你描述 end state，Terraform 算怎麼到達。

## 核心模型

```hcl
resource "aws_s3_bucket" "assets" {
  bucket = "my-assets"
}
```

這是一句宣告：「該有一個叫 my-assets 的 S3 bucket。」你描述終點，過程 Terraform 處理。

- `terraform plan`：比較你的 .tf 檔和 state file，算出 diff。
- `terraform apply`：執行那份 diff，去建立、修改或刪除資源。

## Provider

Terraform 不直接跟 AWS 對話。Provider 是中間層。AWS provider 知道怎麼呼叫 AWS API，GCP provider 知道怎麼呼叫 GCP API。

同一個 `terraform apply` 能同時管 AWS 的 S3 和 Cloudflare 的 DNS。能同時管多家雲，是因為中間有 provider 這一層，負責把 Terraform 的宣告翻譯成各家雲自己的 API 呼叫。

## 代價

State file。Terraform 靠它記住「現在實際有哪些資源」。這份 state 一旦弄丟，Terraform 就會以為那些資源都不存在，然後想把它們整個重建一遍。所以這份 state 得好好保管，這是 Terraform 最脆弱的部分。
