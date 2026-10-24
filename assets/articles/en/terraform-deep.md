---
title: "Terraform: infrastructure is code too, but state is the price"
slug: terraform-deep
date: 2026-03-14
updated: 2026-10-17
revisions: 1
subtitle: "Someone clicked a button in the AWS Console. Three months later nobody remembers what it was."
chapter: "devops"
tags: [terraform, iac, state, devops, infrastructure]
related: [helm-deep, gitops-deep]
---

# Terraform: infrastructure is code too, but state is the price

Someone clicked a button in the AWS Console and created an S3 bucket. Its name is `temp-upload-test-2`.

Three months later, a cost review finds the bucket. It holds 47GB of data. Who created it, when, and which service uses it: none of that can be found, so nobody dares to delete it.

This is called ClickOps, managing infrastructure with a mouse.

---

## Before Terraform

### ClickOps: AWS Console

Log in to the Console and click step by step: Create VPC → Create Subnet → Create Security Group → Launch EC2.

An environment is up in ten minutes. The problems come afterwards:

- **No way to find who changed what**: a security group rule was changed. CloudTrail has a log, but you have to dig through it after the fact.
- **No way to build it again the same way**: staging means clicking through everything again. One manual step differs, and you get "works on staging, fails on prod".
- **No review**: there is no PR. Change an IAM policy and it takes effect immediately. When something breaks, there is no rollback.

### AWS CLI script

```bash
VPC_ID=$(aws ec2 create-vpc --cidr-block 10.0.0.0/16 --query Vpc.VpcId --output text)
aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.0.1.0/24
aws s3 mb s3://my-assets-bucket
```

This can go into a script with version control. But it is not idempotent. Run it a second time:

```
# The first two lines give no error. A VPC has no unique name, and overlapping CIDRs are allowed (AWS VPC FAQ: "you can create
# multiple VPCs with overlapping IP address ranges"), so a second VPC is created, and the subnet goes into that new VPC
# Only the third line errors: BucketAlreadyOwnedByYou (except us-east-1, which returns 200 OK)
```

Every resource needs an if-else for "skip if it already exists". The script keeps growing, and in the end you are maintaining an infra management framework of your own.

### CloudFormation

AWS's official [IaC](chunk://iac) tool. Resources are defined in JSON/YAML, and AWS keeps the state.

```yaml
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: my-assets-bucket
```

Idempotent, with rollback. But:

- **AWS only.** Using GCP? Learn something else. Using Cloudflare DNS? Another tool.
- **Verbose.** Even a simple resource needs a lot of boilerplate.
- **Slow.** When a CloudFormation stack updates, every resource waits for AWS to report completion, and a large stack takes a long wait.

---

## Terraform's core model

### HCL: a declarative language

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

This HCL describes the end state: an S3 bucket should exist, with versioning enabled. There is no "create" or "update" to specify. Terraform works out what to do from the current state.

### Plan → Apply

```bash
terraform plan
```

```
+ aws_s3_bucket.assets will be created
  + bucket = "my-assets-bucket"

Plan: 1 to add, 0 to change, 0 to destroy.
```

Plan computes the diff and lists every change. You review it, then apply.

```bash
terraform apply
```

Terraform creates the bucket. If the bucket already exists with matching settings, it does nothing. Run it any number of times and the result is the same.

`aws cli` executes immediately. ClickOps cannot be undone once the button is pressed. Terraform **lists the diff first and only acts after confirmation.**

### Provider: the middle layer

Terraform itself does not call the AWS API directly. A provider sits in between.

```hcl
provider "aws" {
  region = "us-east-1"
}

provider "cloudflare" {
  api_token = var.cloudflare_token
}
```

Each provider calls its own vendor's API: the AWS provider calls AWS, the Cloudflare provider calls Cloudflare.

The same Terraform code can manage S3 on AWS, DNS on Cloudflare and repo settings on GitHub at the same time.

The Terraform Registry has thousands of providers. AWS, GCP, Azure, Datadog, PagerDuty, Slack. Any service with an API may have a provider.

---

## State: Terraform's memory

### Why state is needed

`terraform plan` computes a diff. A diff needs two sides:

1. the `.tf` files, which are the desired state
2. "what exists now", which is the actual state

How does Terraform know what exists on AWS right now?

**It does not scan the whole account.** It reads its own JSON file, [`terraform.tfstate`](chunk://terraform-state).

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

The state file records each resource's id, attributes and dependencies.

By default, plan refreshes first: it takes the ids recorded in state, reads those resources' current attributes from AWS, then compares the `.tf` files against what came back. A resource not recorded in state is never read, so something someone created in the Console is invisible to plan.

### The problems state brings

**Lose the state and Terraform loses its memory entirely. It assumes nothing was ever created.** The next apply tries to recreate every resource, but the resources on AWS are all still there, and the first name clash is an error.

**State contains secrets.** Database passwords and API keys sit in the state file in plain text.

**State conflicts.** Two people run `terraform apply` at the same time. Each gets a copy of the state, changes different resources, and writes it back. The later write overwrites the earlier one, and the resources the first person created vanish from state.

### Remote State: the fix

State contains secrets, so it cannot go in Git. Kept on a laptop, it is lost when the laptop is replaced, and two people applying at once still conflict.

The standard fix: **S3, with S3's own locking.** (Before 1.10 you paired it with a DynamoDB table for the lock; `dynamodb_table` is deprecated since 1.11.)

```hcl
terraform {
  backend "s3" {
    bucket         = "my-terraform-state"
    key            = "global/terraform.tfstate"
    region         = "us-east-1"
    use_lockfile   = true
    encrypt        = true
  }
}
```

- **S3** stores the state file, encrypted and with versioning on.
- **`use_lockfile`** takes the lock with an S3 conditional write. While one person applies, anyone else running `terraform plan` is blocked: "State locked by user X".

---

## Module: reuse

A Terraform module is a packaged set of resource definitions. The user only fills in parameters. This block builds a whole EKS cluster from one module:

```hcl
module "eks" {
  source = "./modules/eks-cluster"

  cluster_name    = "production"
  node_count      = 3
  instance_type   = "m5.large"
  k8s_version     = "1.28"
}
```

Inside, the module may hold 30 resources (VPC, subnets, security groups, the EKS cluster, node groups, IAM roles). The caller sees only the four parameters above.

A [Helm](chunk://helm) chart works the same way. The chart turns a set of k8s YAML into templates, and the user only fills in values.yaml.

Companies write internal modules: `modules/eks-cluster/`, `modules/rds/`, `modules/vpc/`. A new environment is just parameters.

The Terraform Registry also has public modules, like Helm's public chart repos.

---

## `.tftpl`: template files

Terraform has its own templating mechanism. `.tftpl` files are processed with the `templatefile()` function:

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

Inside the template, the syntax is `${var_name}`:

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

Terraform injects the variables at plan time and produces the final JSON. Different environments (dev, staging, prod) have different `api_origin` values, but the template is written once.

A real example: if the frontend's enum expects camelCase keys, the template itself has to use camelCase keys. `templatefile()` substitutes values only and never converts keys. Whatever is written in the template is what comes out.

---

## The price of Terraform

### State is a single point of failure

State gone, memory gone. Remote state with locking lowers the risk but cannot remove it.

### `terraform import` only does half the job

Someone created a resource by hand. Now you want to pull it under Terraform's management.

```bash
terraform import aws_s3_bucket.legacy my-legacy-bucket
```

Import only adds the resource to state. Before 1.5 the matching `.tf` definition had to be written by hand, and missing one attribute meant a diff on the next plan; since 1.5 an `import {}` block plus `terraform plan -generate-config-out=` generates it first, and you tidy it up.

For a large import, 100 manually created resources still means 100 generated blocks to check one at a time.

### Drift

Someone changed a security group rule in the Console. State does not have that change.

```bash
terraform plan
```

```
~ aws_security_group_rule.allow_ssh
    from_port: 22 → 0   # ???
```

A change shows up in plan that nobody made in code. That is [drift](chunk://drift). Who changed it and why is unclear. `terraform apply` will change it back. What if that manual change was an emergency fix?

### Destruction is immediate

```bash
terraform destroy
```

Every resource is deleted. There is no undo.

---

## The three layers together

```
Terraform       Helm           k8s
───────────    ───────────    ───────────
.tf files      values.yaml    Deployment YAML
    ↓              ↓              ↓
terraform      helm           kubectl
plan/apply     install        apply
    ↓              ↓              ↓
AWS infra      k8s resources  container runtime
(VPC, EKS,     (Deployment,   (Pods running
 S3, RDS)       Service,       on nodes)
                ConfigMap)
```

All three layers are declarative, and all three diff first, then apply.

But `terraform apply` and `helm install` are still run by a person in a terminal. In that respect it is the same as ClickOps: if someone runs the staging config against prod, there is no mechanism to stop it.

---

## Taking apply out of human hands

**[GitOps](chunk://gitops)** takes both `terraform apply` and `helm upgrade` out of human hands. Git commit = trigger. ArgoCD watches Git from inside the cluster and syncs k8s resources automatically. Atlantis runs `terraform plan` in the PR and auto-applies after merge.

People are responsible only for reviewing and merging the PR. Everything after that is done by machines.
