---
title: "Terraform"
slug: terraform
brief: "宣告式基礎設施佈建。Provider 模型跨雲。State file 記錄實際有哪些資源，弄丟了 Terraform 會想全部重建。"
date: 2026-03-14
updated: 2026-10-18
revisions: 2
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

這是一句宣告：「該有一個叫 my-assets 的 S3 bucket。」沒有寫怎麼建，也沒有寫先檢查存不存在。

Terraform 手上有三樣東西：.tf 檔（想要的樣子）、state file（上次 apply 完它記下來的樣子）、雲端 API（真正的樣子）。`terraform plan` 把三份對一遍，算出差異；`terraform apply` 把那份差異做掉。

第一次跑，state 是空的，plan 顯示 `+ aws_s3_bucket.assets`，apply 之後 bucket 建好，state 記下「assets 對應到 AWS 上的 my-assets」。接著在 .tf 裡加一行 `tags = { team = "web" }`，再 plan，Terraform 拿 .tf 跟 state 比，顯示 `~ aws_s3_bucket.assets  tags: {} → { team = "web" }`，只改這一項，不會重建 bucket。把整段 resource 刪掉再 plan，顯示 `- aws_s3_bucket.assets`。bucket 是空的，apply 就把它刪掉；裡面還有檔案的話，因為 AWS provider 的 `force_destroy` 預設是 `false`，apply 會報錯，bucket 跟檔案都留著。

## Provider

Terraform 不直接呼叫 AWS，中間隔著一層 provider。上面那個 `+ aws_s3_bucket` 到了 apply 的時候，是 AWS provider 把它翻成 `CreateBucket` 這個 API 呼叫送出去的。同一份 .tf 裡再寫一個 `cloudflare_record`，就由 Cloudflare provider 翻成 Cloudflare 的 API，一次 apply 同時管 AWS 的 S3 跟 Cloudflare 的 DNS。

## 代價

State file。回到上面那個 bucket，要是 state file 弄丟了，.tf 裡還是寫著要有 my-assets，state 卻是空的，plan 就會顯示 `+ aws_s3_bucket.assets`，apply 下去會因為 bucket 已經存在而失敗。換成 EC2 instance 這種名字不唯一的資源，apply 會直接再開一台一模一樣的，原本那台沒人管了。這是 Terraform 最脆弱的部分，所以 state 幾乎都放遠端（S3 加 lock），不放在誰的筆電上。
