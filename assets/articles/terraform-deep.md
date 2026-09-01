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

三個月後，成本優化時看到這個 bucket。裡面有 47GB 的資料。誰建的、什麼時候建的、哪個服務在用，全都不清楚。刪了會怎樣？不知道。不敢刪。

這叫 ClickOps。用滑鼠管理基礎設施。快，但不可追蹤、不可重現、不可 review。

---

## Before Terraform

### ClickOps：AWS Console

登入 Console，一步步點：Create VPC → Create Subnet → Create Security Group → Launch EC2。

十分鐘完成建立一個環境。問題：

**不可追蹤。** 誰改了 security group rule？CloudTrail 有 log，但要事後去翻。**不可重現。** 建 staging 要再點一次。手動步驟不一致，環境產生差異，「staging 可以 prod 不行」。**不可 review。** 沒有 PR。改了 IAM policy 就是改了。沒有 review、沒有 approval、沒有 rollback。

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

AWS 的官方 [IaC](chunk://iac) 工具。JSON/YAML 定義 resource，AWS 負責管 state。

```yaml
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: my-assets-bucket
```

冪等，有 rollback。但：

- **AWS 限定。** 用 GCP？重學。用 Cloudflare DNS？另一個工具。
- **冗長。** 簡單的東西要寫很多 boilerplate。
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

Plan 算 diff。執行前能看到所有變更。review 完才 apply。

```bash
terraform apply
```

Terraform 建立 bucket。如果 bucket 已存在且設定一致，就什麼都不做，跑幾次結果都一樣。

這是 Terraform 最強的地方：**永遠可以先看 diff 再決定。** `aws cli` 直接執行，ClickOps 按下去就回不來。Terraform 多了一層 review。

### Provider：中間層

Terraform 不直接跟 AWS 對話。Provider 是中間層。

```hcl
provider "aws" {
  region = "us-east-1"
}

provider "cloudflare" {
  api_token = var.cloudflare_token
}
```

AWS provider 知道怎麼呼叫 AWS API。Cloudflare provider 知道怎麼呼叫 Cloudflare API。

同一份 Terraform code 能同時管 AWS 的 S3 + Cloudflare 的 DNS + GitHub 的 repo settings。跨雲就是這樣靠 provider 做到的。

Terraform Registry 有幾千個 provider。AWS、GCP、Azure、Datadog、PagerDuty、Slack，任何有 API 的東西都可能有 provider。

---

## State：Terraform 的記憶

### 為什麼需要 state

`terraform plan` 算 diff。Diff 需要兩端：

1. `.tf` 檔，也就是 desired state
2. 「現在有什麼」，也就是 actual state

Terraform 怎麼知道 AWS 上現在有什麼？

**它不 scan。** 它讀自己的 [`terraform.tfstate`](chunk://terraform-state)，一個 JSON 檔案。

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

Plan = diff(`.tf` 檔, state file)。注意：是跟 state file 比，不是跟 AWS 實際狀態比。

### State 帶來的問題

**State 弄丟，Terraform 整個失憶，當作什麼都沒建過。**下次 apply 會試圖重建所有東西。但 AWS 上 resource 還在，名稱衝突，直接報錯。

**State 含 secret。** 資料庫密碼、API key 都存在 state file 裡。明文。

**State 衝突。** 兩個人同時 `terraform apply`，各自拿到一份 state，各自改了不同的 resource，各自寫回。後寫的覆蓋先寫的。Resource 遺失。

### Remote State：解法

State 不能放 Git（含 secret）。不能放本機（會丟、會衝突）。

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

- **S3** 存 state file。加密。版本控制（S3 versioning）。
- **DynamoDB** 做 distributed lock。一個人在 apply 時，其他人 `terraform plan` 會被擋住：「State locked by user X」。

---

## Module：重用

跟 Helm chart 類似，Terraform module 是一組可重用的 resource 定義。

```hcl
module "eks" {
  source = "./modules/eks-cluster"

  cluster_name    = "production"
  node_count      = 3
  instance_type   = "m5.large"
  k8s_version     = "1.28"
}
```

Module 內部可能包含 30 個 resource（VPC、subnet、security group、EKS cluster、node group、IAM role）。呼叫方只需要填幾個參數。

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

實際應用例子：用 `.tftpl` 把 key 從 kebab-case 改成 camelCase，讓前端的 enum 能直接對應。

---

## Terraform 的代價

### State 是 single point of failure

前面講了。State 不見，Terraform 失憶。Remote state + locking 緩解但不消除風險。

### `terraform import` 很痛

有人手動建了 resource。現在想把它「拉進」Terraform 管。

```bash
terraform import aws_s3_bucket.legacy my-legacy-bucket
```

Import 只把 resource 加進 state。對應的 `.tf` 定義還是要手動寫。少寫一個 attribute，下次 plan 就會顯示 diff。

大規模 import（100 個手動建的 resource）是惡夢。每個都要手動對。

### Drift

有人在 Console 改了 security group rule。State 不知道。

```bash
terraform plan
```

```
~ aws_security_group_rule.allow_ssh
    from_port: 22 → 0   # ???
```

出現一個沒人從 code 改過的改動。是 [drift](chunk://drift)。誰改的、為什麼改的，不清楚。`terraform apply` 會把它改回去。如果那個手動改動是救火用的呢？

### 破壞是即時的

```bash
terraform destroy
```

所有 resource 刪除。沒有 undo。`terraform apply` 的 plan 顯示 `destroy` 時，仔細看。

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

三層。每層都是宣告式。每層都有 diff + apply 的模式。

但誰觸發 `terraform apply` 和 `helm install`？

目前是人。人開 terminal，跑指令。

這跟 ClickOps 有什麼差別？工具不同，但模式一樣：人手動執行。忘了跑？版本不對？跑錯環境？都可能。

---

## 這篇沒講到的

**[GitOps](chunk://gitops)** 把 `terraform apply` 和 `helm upgrade` 都從人手裡拿走。Git commit = 觸發。ArgoCD 在 cluster 裡 watch Git，自動 sync k8s resources。Atlantis 在 PR 裡跑 `terraform plan`，merge 後 auto-apply。

人負責的只有 review 跟 merge PR，後面全是機器在做。

那是最後一篇的故事。
