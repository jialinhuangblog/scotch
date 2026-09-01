---
title: "Terraform State"
slug: terraform-state
brief: "Terraform 的記憶。Remote backend（S3 + DynamoDB lock）防止同時 apply 和 state 遺失。"
date: 2026-03-14
article: terraform-deep
---

# Terraform State

這個 state 是 Terraform 記住現況的地方，也是它最容易出事的環節。

## 為什麼需要 state

`terraform plan` 算 diff。但 diff 需要兩端：你的 .tf 檔（desired）和「現在有什麼」（actual）。

Terraform 不 scan 雲端。它讀自己的 `terraform.tfstate`，一個 JSON 檔案，記錄每個 resource 的 id、屬性、依賴關係。

State 不見 → Terraform 以為什麼都不存在 → 下次 apply 會試圖重建所有東西。

## Remote state

State 不能放 Git：它含 secret（資料庫密碼、API key），而且多人同時 `terraform apply` 會讀到同一份 state、各自改再各自寫回去，後寫的蓋掉前寫的，state 就壞了。

標準解法是放 remote backend，最常見 S3 + DynamoDB，兩者分工不同：

- **S3 存 state 檔案**：一個共用、加密、有版本的地方，大家讀同一份。
- **DynamoDB 做 lock**：apply 開始時 Terraform 在 DynamoDB 寫一筆 lock 紀錄，結束才刪。第二個人來 apply 看到那筆紀錄，就只能停下來等前一個做完。

為什麼鎖不直接用 S3？鎖需要一個「原子的搶佔」：沒人佔就佔住、有人佔就失敗。早期 S3 既沒有強一致、也沒有條件寫入，做不出可靠的鎖，所以才多拉一個有 conditional write 的 DynamoDB。S3 存實際的 state 檔，DynamoDB 只是標記「現在有人在改」的鎖。

新版本（Terraform 1.10+）S3 自己就能鎖，不用再開 DynamoDB：backend 加 `use_lockfile = true`，Terraform 會在 state 旁邊寫一個 `.tflock` 物件，用 S3 的 conditional write（不存在才寫得進去）當原子鎖。官方已把 DynamoDB locking 標為 deprecated。

```hcl
terraform {
  backend "s3" {
    bucket       = "my-tf-state"
    key          = "prod/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true   # S3 自己鎖，不用 DynamoDB
  }
}
```

## Drift

有人手動在 AWS Console 改了東西。State file 不知道。下次 `terraform plan` 會顯示不預期的 diff。這叫 drift。

`terraform refresh` 可以更新 state，但它不一定能抓到所有改動。最好的做法是不准任何人手動改，變更全部經過 Terraform。
