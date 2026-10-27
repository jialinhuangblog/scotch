---
title: "Terraform"
slug: terraform
brief: "Declarative infrastructure provisioning. The provider model spans clouds. The state file records which resources really exist; lose it and Terraform wants to rebuild everything."
date: 2026-03-14
updated: 2026-10-18
revisions: 2
article: terraform-deep
---

# Terraform

Describe the end state; Terraform works out how to get there.

## The core model

```hcl
resource "aws_s3_bucket" "assets" {
  bucket = "my-assets"
}
```

This is one declaration: "there should be an S3 bucket called my-assets." It does not say how to create it, and it does not check first whether it exists.

Terraform holds three things: the .tf files (what you want), the state file (what it recorded after the last apply), and the cloud API (what really exists). `terraform plan` compares the three and works out the difference; `terraform apply` carries that difference out.

On the first run the state is empty, plan shows `+ aws_s3_bucket.assets`, apply creates the bucket, and the state records "assets maps to my-assets on AWS". Next, add a line `tags = { team = "web" }` to the .tf and plan again. Terraform compares the .tf with the state and shows `~ aws_s3_bucket.assets  tags: {} → { team = "web" }`. Only that one attribute changes; the bucket is not rebuilt. Delete the whole resource block and plan shows `- aws_s3_bucket.assets`. If the bucket is empty, apply deletes it. If it still holds files, apply fails with an error, because the AWS provider's `force_destroy` defaults to `false`, and both the bucket and its files stay.

## Provider

Terraform does not call AWS itself. A provider sits in between. When that `+ aws_s3_bucket` reaches apply, the AWS provider translates it into the `CreateBucket` API call and sends it. Write a `cloudflare_record` in the same .tf and the Cloudflare provider translates it into Cloudflare's API, so one apply manages S3 on AWS and DNS on Cloudflare at the same time.

## The cost

The state file. Back to the bucket above: if the state file is lost, the .tf still says my-assets should exist while the state is empty, so plan shows `+ aws_s3_bucket.assets`, and apply fails because the bucket already exists. With a resource whose name is not unique, such as an EC2 instance, apply simply launches a second identical one and the original is left with nobody managing it. This is the most fragile part of Terraform, which is why state almost always lives remotely (S3 with a lock), never on someone's laptop.
