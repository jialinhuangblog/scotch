---
title: "Infrastructure as Code"
slug: iac
brief: "Infrastructure defined in version-controlled files, not hand clicks in the Console (ClickOps)."
date: 2026-03-14
updated: 2026-10-18
revisions: 2
article: terraform-deep
---

# Infrastructure as Code

Manage infrastructure with code, instead of clicking by hand in the Console.

## The problem with ClickOps

Click a button in the AWS Console to create an S3 bucket called `reports-tmp`. Three months later the bill shows an extra 40 dollars a month in storage. Someone opens the bucket and finds 2TB of files, and nobody can say why it was created, which service writes to it, or whether it can be deleted. To find out who created it, CloudTrail's default event history keeps only the last 90 days, so the record of a bucket created three months ago may already be gone. Even if the account has a separate trail that stores records in S3 for longer, it shows who clicked, but not why.

A second case. Someone ticks the wrong checkbox on a security group and opens the database's port 5432 to 0.0.0.0/0. There is no review step in between. The change takes effect the moment it is saved, and it stays that way until a scanner or an attacker finds it first.

## How IaC does it

The same bucket, written in a file instead:

```hcl
resource "aws_s3_bucket" "reports_tmp" {
  bucket = "reports-tmp"
  tags   = { owner = "data-team", purpose = "monthly report staging" }
}
```

This file goes into Git and a PR is opened. The reviewer sees the tags and knows who owns it and what it is for. Before merging, `terraform plan` runs and prints `1 to add, 0 to change, 0 to destroy`, confirming that only this one bucket is added and nothing else is touched. After the merge, `terraform apply` creates it for real. Three months later, `git log` shows who added the bucket, on which day, and the reason written in the PR. To delete it, delete this block and apply again. But this bucket holds 2TB of files, and S3 does not allow deleting a bucket that still has objects in it, so the apply fails at this step. For Terraform to delete the files along with the bucket, first add `force_destroy = true` to the resource and apply once, so the value is written into the state; after that, deleting the block and applying succeeds. The other way is to empty the bucket first.

The change that opened 5432 to the world, going through this path, would show `cidr_blocks = ["0.0.0.0/0"]` in the PR diff, and the reviewer would ask for it to be changed before the merge.

Tools: Terraform (multiple clouds), CloudFormation (AWS only), Pulumi (infra written in a general-purpose language such as TypeScript or Python).
