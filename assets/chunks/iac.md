---
title: "Infrastructure as Code"
slug: iac
brief: "用版本控制的設定管理基礎設施，取代在 Console 上手動點擊（ClickOps）。"
date: 2026-03-14
updated: 2026-10-18
revisions: 2
article: terraform-deep
---

# Infrastructure as Code

用 code 管理基礎設施，不再靠在 Console 上手動點。

## ClickOps 的問題

在 AWS Console 點按鈕建一個 S3 bucket，叫 `reports-tmp`。過了三個月，帳單上多了每月 40 美元的儲存費，有人點進去看，bucket 裡有 2TB 的檔案，沒人說得出它當初為什麼建、哪個服務在寫、能不能刪。想查是誰建的，CloudTrail 預設的 event history 只留最近 90 天，三個月前建 bucket 的那筆紀錄可能已經過期。就算帳號另外建了 trail、把紀錄長期存進 S3，也只查得到是誰點的，查不到為什麼。

另一種情況。有人在 security group 上點錯一個 checkbox，把資料庫的 5432 port 開給 0.0.0.0/0。中間沒有 review 這個步驟，改完就生效，要等掃描工具或攻擊者先發現。

## IaC 怎麼做

同一個 bucket 改成寫在檔案裡：

```hcl
resource "aws_s3_bucket" "reports_tmp" {
  bucket = "reports-tmp"
  tags   = { owner = "data-team", purpose = "monthly report staging" }
}
```

這個檔案進 Git，開 PR。reviewer 看到 tags 就知道誰負責、拿來做什麼。合併前跑 `terraform plan`，輸出 `1 to add, 0 to change, 0 to destroy`，確認只會多這一個 bucket，不會動到別的。合併後 `terraform apply` 才真的建出來。三個月後再看這個 bucket，`git log` 查得到是誰、哪一天、PR 裡寫了什麼理由。要刪的話，刪掉這段 code 再 apply，不過這個 bucket 裡有 2TB 的檔案，而 S3 不准刪除還有物件的 bucket，apply 會在這一步報錯。要讓 Terraform 連檔案一起刪，得先在 resource 加上 `force_destroy = true` 並 apply 一次，讓這個值寫進 state，之後刪掉 code 再 apply 才會成功。另一條路是先把 bucket 清空。

那個把 5432 開給全世界的改動，走這條路的話，PR 的 diff 會出現 `cidr_blocks = ["0.0.0.0/0"]`，reviewer 在合併前就會要求改掉。

工具：Terraform（多雲）、CloudFormation（AWS 限定）、Pulumi（用程式語言寫）。
