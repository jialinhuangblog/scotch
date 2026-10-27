---
title: "Terraform State"
slug: terraform-state
brief: "The JSON file where Terraform records existing resources. A remote backend (S3 with native locking) prevents concurrent applies and lost state."
date: 2026-03-14
updated: 2026-10-17
revisions: 1
article: terraform-deep
---

# Terraform State

State is where Terraform records the current situation.

## Why state is needed

`terraform plan` computes a diff. But a diff needs two sides: the .tf files (desired) and "what exists now" (actual).

Terraform does not scan the whole cloud account. It reads its own `terraform.tfstate`. This JSON file records each resource's id, attributes and dependencies. By default, plan uses these ids to read each resource's current attributes from the cloud (refresh); a resource not recorded in state is never read.

State gone → Terraform assumes nothing exists → the next apply tries to recreate every resource.

## Remote state

State cannot go in Git: it contains secrets (database passwords, API keys), and when several people run `terraform apply` at the same time, they read the same state, each changes it, and each writes it back. The later write overwrites the earlier one, and the state is corrupted.

The standard fix is a remote backend, most often S3 + DynamoDB, each with its own job:

- **S3 stores the state file**: one shared, encrypted, versioned place, and everyone reads the same copy.
- **DynamoDB does the lock**: when an apply starts, Terraform writes a lock record into DynamoDB and deletes it when done. A second person who comes to apply sees that record and has to stop and wait for the first one to finish.

Why not lock with S3 directly? A lock needs an "atomic grab": if nobody holds it, take it; if someone does, fail. Early S3 had neither strong consistency nor conditional writes, so a reliable lock could not be built on it. That is why a DynamoDB with conditional writes was added.

Newer S3 can lock on its own (added as an experimental feature in Terraform 1.10, generally available in 1.11), so DynamoDB is no longer needed: add `use_lockfile = true` to the backend, and Terraform writes a `.tflock` object next to the state, using S3's conditional write (write only if the object does not exist) as the atomic lock. DynamoDB locking has officially been marked deprecated.

```hcl
terraform {
  backend "s3" {
    bucket       = "my-tf-state"
    key          = "prod/terraform.tfstate"
    region       = "us-east-1"
    use_lockfile = true   # S3 locks on its own, no DynamoDB
  }
}
```

## Drift

Someone changes a setting by hand in the AWS Console, and the state file has no record of that change. The next `terraform plan` shows an unexpected diff. That is drift.

`terraform apply -refresh-only` syncs the actual state in the cloud into the state file (the old `terraform refresh` is no longer recommended). But it only checks resources Terraform manages; a resource someone created in the Console is unknown to it. So in practice, manual changes are forbidden and every change goes through Terraform.
