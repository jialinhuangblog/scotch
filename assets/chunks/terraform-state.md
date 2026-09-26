---
title: "Terraform State"
slug: terraform-state
brief: "Terraform 記錄現有 resource 的 JSON 檔。Remote backend（S3 + DynamoDB lock）防止同時 apply 和 state 遺失。"
date: 2026-03-14
article: terraform-deep
---

# Terraform State

State 是 Terraform 記錄現況的地方。

## 為什麼需要 state

`terraform plan` 算 diff。但 diff 需要兩端：.tf 檔（desired）和「現在有什麼」（actual）。

Terraform 不 scan 整個雲端帳號。它讀自己的 `terraform.tfstate`，一個 JSON 檔案，記錄每個 resource 的 id、屬性、依賴關係。plan 預設會照這些 id 去雲端讀取每個 resource 現在的屬性（refresh），state 裡沒記的 resource 它不會去讀。

State 不見 → Terraform 以為什麼都不存在 → 下次 apply 會試圖重建所有 resource。

## Remote state

State 不能放 Git：它含 secret（資料庫密碼、API key），而且多人同時 `terraform apply` 會讀到同一份 state、各自改再各自寫回去，後寫的蓋掉前寫的，state 就壞了。

標準解法是放 remote backend，最常見 S3 + DynamoDB，兩者分工不同：

- **S3 存 state 檔案**：一個共用、加密、有版本的地方，大家讀同一份。
- **DynamoDB 做 lock**：apply 開始時 Terraform 在 DynamoDB 寫一筆 lock 紀錄，結束才刪。第二個人來 apply 看到那筆紀錄，就只能停下來等前一個做完。

為什麼鎖不直接用 S3？鎖需要一個「原子的搶佔」：沒人佔就佔住、有人佔就失敗。早期 S3 既沒有強一致、也沒有條件寫入，做不出可靠的鎖，所以才多拉一個有 conditional write 的 DynamoDB。

新版本 S3 自己就能鎖（Terraform 1.10 以實驗功能加入，1.11 正式可用），不用再開 DynamoDB：backend 加 `use_lockfile = true`，Terraform 會在 state 旁邊寫一個 `.tflock` 物件，用 S3 的 conditional write（物件不存在時才能寫入）當原子鎖。官方已把 DynamoDB locking 標為 deprecated。

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

有人手動在 AWS Console 改了設定，state file 裡沒有這筆修改。下次 `terraform plan` 會顯示不預期的 diff。這叫 drift。

`terraform apply -refresh-only` 可以把雲端上的實際狀態同步進 state（舊的 `terraform refresh` 已經不建議用）。但它只會檢查 Terraform 管理的 resource，有人在 Console 新建的資源它不會知道。所以實務上會禁止手動修改，所有變更都經過 Terraform。
