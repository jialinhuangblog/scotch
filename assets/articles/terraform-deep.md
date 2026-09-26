---
title: "Terraform：基礎設施也是 Code，但 State 是代價"
slug: terraform-deep
date: 2026-03-14
subtitle: "AWS Console 按了一個按鈕。三個月後沒人記得那是什麼。"
chapter: "devops"
tags: [terraform, iac, state, devops, infrastructure]
related: [helm-deep, gitops-deep]
---

# Terraform：基礎設施也是 Code，但 State 是代價

有人在 AWS Console 按了一個按鈕，建了一個 S3 bucket。名字叫 `temp-upload-test-2`。

三個月後，成本優化時看到這個 bucket。裡面有 47GB 的資料。誰建的、什麼時候建的、哪個服務在用，全都查不到，所以也沒人敢刪。

這叫 ClickOps，用滑鼠管理基礎設施。

---

## Before Terraform

### ClickOps：AWS Console

登入 Console，一步步點：Create VPC → Create Subnet → Create Security Group → Launch EC2。

十分鐘就能建好一個環境，問題出在事後：

- **查不到誰改的**：security group rule 被改了，CloudTrail 有 log，但要事後去翻。
- **沒辦法照著再建一次**：建 staging 要再點一次，手動步驟一不一致，就出現「staging 可以 prod 不行」。
- **沒有 review**：沒有 PR，改了 IAM policy 就直接生效，出事也沒辦法 rollback。

### AWS CLI script

```bash
aws ec2 create-vpc --cidr-block 10.0.0.0/16
aws ec2 create-subnet --vpc-id vpc-xxx --cidr-block 10.0.1.0/24
aws s3 mb s3://my-assets-bucket
```

可以放進 script，有 version control。但不冪等。跑第二次：

```
An error occurred (VpcLimitExceeded): vpc-xxx already exists
```

每個 resource 都要加 if-else 判斷「如果已存在就跳過」。script 越來越複雜，最終變成在維護一個自製的 infra management 框架。

### CloudFormation

AWS 的官方 [IaC](chunk://iac) 工具。JSON/YAML 定義 resource，AWS 負責保存 state。

```yaml
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: my-assets-bucket
```

冪等，有 rollback。但：

- **AWS 限定。** 用 GCP？重學。用 Cloudflare DNS？另一個工具。
- **冗長。** 一個簡單的 resource 也要寫很多 boilerplate。
- **慢。** CloudFormation stack 更新時 AWS 背後是串列執行，大型 stack 要等很久。

---

## Terraform 的核心模型

### HCL：宣告式語言

```hcl
resource "aws_s3_bucket" "assets" {
  bucket = "my-assets-bucket"
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  versioning_configuration {
    status = "Enabled"
  }
}
```

這段 HCL 描述的是 end state：應該存在一個 S3 bucket，而且開啟 versioning。不需要指定「建立」或「更新」，Terraform 會根據目前的狀態自己判斷該做什麼。

### Plan → Apply

```bash
terraform plan
```

```
+ aws_s3_bucket.assets will be created
  + bucket = "my-assets-bucket"

Plan: 1 to add, 0 to change, 0 to destroy.
```

Plan 會算出 diff，把所有變更列出來，review 完才 apply。

```bash
terraform apply
```

Terraform 建立 bucket。如果 bucket 已存在且設定一致，就什麼都不做，跑幾次結果都一樣。

`aws cli` 直接執行，ClickOps 按下去就回不來，Terraform 則會**先列出 diff，確認了才動手。**

### Provider：中間層

Terraform 本身不直接呼叫 AWS API，中間隔著一層 provider。

```hcl
provider "aws" {
  region = "us-east-1"
}

provider "cloudflare" {
  api_token = var.cloudflare_token
}
```

每個 provider 負責呼叫自己那家的 API，AWS provider 呼叫 AWS，Cloudflare provider 呼叫 Cloudflare。

同一份 Terraform code 能同時管 AWS 的 S3 + Cloudflare 的 DNS + GitHub 的 repo settings。跨雲就是這樣靠 provider 做到的。

Terraform Registry 有幾千個 provider。AWS、GCP、Azure、Datadog、PagerDuty、Slack，任何有 API 的服務都可能有 provider。

---

## State：Terraform 的記憶

### 為什麼需要 state

`terraform plan` 算 diff。Diff 需要兩端：

1. `.tf` 檔，也就是 desired state
2. 「現在有什麼」，也就是 actual state

Terraform 怎麼知道 AWS 上現在有什麼？

**它不 scan 整個帳號。** 它讀自己的 [`terraform.tfstate`](chunk://terraform-state)，一個 JSON 檔案。

```json
{
  "resources": [
    {
      "type": "aws_s3_bucket",
      "name": "assets",
      "instances": [
        {
          "attributes": {
            "id": "my-assets-bucket",
            "bucket": "my-assets-bucket",
            "arn": "arn:aws:s3:::my-assets-bucket"
          }
        }
      ]
    }
  ]
}
```

State file 記錄每個 resource 的 id、屬性、依賴關係。

plan 預設會先 refresh，照 state 裡記的 id 去 AWS 讀取這些 resource 現在的屬性，再拿 `.tf` 檔跟讀回來的結果比。state 裡沒記的 resource，Terraform 不會去讀，所以有人在 Console 新建的東西，plan 看不到。

### State 帶來的問題

**State 弄丟，Terraform 整個失憶，當作什麼都沒建過。**下次 apply 會試圖重建所有 resource，但 AWS 上的 resource 都還在，名稱一衝突就直接報錯。

**State 含 secret。** 資料庫密碼、API key 都以明文存在 state file 裡。

**State 衝突。** 兩個人同時 `terraform apply`，兩邊都拿到一份 state、改了不同的 resource 再寫回去。後寫的會蓋掉先寫的，先寫那個人建的 resource 就從 state 裡消失了。

### Remote State：解法

State 含 secret，所以不能放 Git。放本機的話，筆電一換就丟，兩個人同時 apply 又會衝突。

標準解法：**S3 + DynamoDB。**

```hcl
terraform {
  backend "s3" {
    bucket         = "my-terraform-state"
    key            = "global/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "terraform-locks"
    encrypt        = true
  }
}
```

- **S3** 存 state file，加密並開 versioning。
- **DynamoDB** 做 distributed lock。一個人在 apply 時，其他人 `terraform plan` 會被擋住：「State locked by user X」。

---

## Module：重用

Terraform module 是一包寫好的 resource 定義，用的人只要填參數。下面這段用一個 module 建出整套 EKS cluster：

```hcl
module "eks" {
  source = "./modules/eks-cluster"

  cluster_name    = "production"
  node_count      = 3
  instance_type   = "m5.large"
  k8s_version     = "1.28"
}
```

Module 內部可能包含 30 個 resource（VPC、subnet、security group、EKS cluster、node group、IAM role），呼叫方看到的只有上面那四個參數。

[Helm](chunk://helm) chart 也是這樣用的。chart 把一組 k8s YAML 寫成模板，用的人只填 values.yaml。

公司內部寫 module：`modules/eks-cluster/`、`modules/rds/`、`modules/vpc/`。新環境只要填參數就能建。

Terraform Registry 也有公開 module。跟 Helm 的公開 chart repo 一樣。

---

## `.tftpl`：模板檔案

Terraform 有自己的模板機制。`.tftpl` 檔案用 `templatefile()` 函數處理：

```hcl
resource "aws_s3_object" "checkpoints" {
  bucket  = aws_s3_bucket.assets.id
  key     = "public/json/services_availability_checkpoints.json"
  content = templatefile("${path.module}/files/services_availability_checkpoints.json.tftpl", {
    api_origin = var.api_origin
    ce_origin  = var.ce_origin
  })
}
```

模板裡用 `${var_name}` 語法：

```json
{
  "initialScreen": {
    "action": "errorPage",
    "checkpoints": [
      {
        "strategy": "http",
        "url": "${api_origin}/health"
      }
    ]
  }
}
```

Terraform 在 plan 時注入變數，產出最終 JSON。不同環境（dev、staging、prod）有不同的 `api_origin`，但模板只寫一次。

實際應用例子：把模板裡的 key 從 kebab-case 改寫成 camelCase，讓前端的 enum 能直接對應。`templatefile()` 不會轉換 key，模板裡寫什麼就輸出什麼。

---

## Terraform 的代價

### State 是 single point of failure

State 不見，Terraform 就失憶。Remote state 加 locking 能降低風險，但沒辦法消除。

### `terraform import` 只做一半

有人手動建了 resource。現在想把它「拉進」Terraform 管。

```bash
terraform import aws_s3_bucket.legacy my-legacy-bucket
```

Import 只把 resource 加進 state。對應的 `.tf` 定義還是要手動寫。少寫一個 attribute，下次 plan 就會顯示 diff。

大規模 import 的話，100 個手動建的 resource 每一個都要手動對一次。

### Drift

有人在 Console 改了 security group rule。State 裡沒有這個改動。

```bash
terraform plan
```

```
~ aws_security_group_rule.allow_ssh
    from_port: 22 → 0   # ???
```

plan 裡出現一個沒人從 code 改過的改動，這就是 [drift](chunk://drift)。誰改的、為什麼改的，不清楚。`terraform apply` 會把它改回去。如果那個手動改動是救火用的呢？

### 破壞是即時的

```bash
terraform destroy
```

所有 resource 刪除，沒有 undo。

---

## 三層合在一起看

```
Terraform       Helm           k8s
───────────    ───────────    ───────────
.tf 檔         values.yaml    Deployment YAML
    ↓              ↓              ↓
terraform      helm           kubectl
plan/apply     install        apply
    ↓              ↓              ↓
AWS infra      k8s resources  container runtime
(VPC, EKS,     (Deployment,   (Pod 在 node
 S3, RDS)       Service,       上跑起來)
                ConfigMap)
```

三層都是宣告式，都走 diff 再 apply。

但 `terraform apply` 跟 `helm install` 現在還是人在 terminal 手動跑。這點跟 ClickOps 一樣，要是有人對著 prod 跑了 staging 的設定，也沒有機制攔下來。

---

## apply 怎麼從人手裡拿走

**[GitOps](chunk://gitops)** 把 `terraform apply` 和 `helm upgrade` 都從人手裡拿走。Git commit = 觸發。ArgoCD 在 cluster 裡 watch Git，自動 sync k8s resources。Atlantis 在 PR 裡跑 `terraform plan`，merge 後 auto-apply。

人負責的只有 review 跟 merge PR，後面全是機器在做。
