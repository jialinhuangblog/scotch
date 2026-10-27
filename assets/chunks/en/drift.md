---
title: "Drift"
slug: drift
brief: "Actual state departs from declared state. Manual edits, failed applies, stale config. Every layer can drift."
date: 2026-03-14
---

# Drift

When the state written in the declaration does not match the system's actual state, that is drift. It can happen at every layer.

## Drift at three layers

**k8s**: someone ran `kubectl edit` and changed a deployment's replica count. The YAML says 3, the cluster runs 5. The next apply forces it back to 3, but during the time in between nobody knows.

**Terraform**: someone changed a security group rule by hand in the AWS Console. The state file does not know. `terraform plan` shows a diff that no code change produced.

**Helm**: `helm upgrade` failed halfway. Some resources were updated, some were not. The release status is `failed`, but the cluster is half new, half old.

## Why drift is dangerous

The system's actual state differs from what everyone believes, so decisions rest on a wrong premise. And usually nobody notices until something breaks.

## Defenses

1. **Forbid manual changes**: every change goes through Git + CI/CD
2. **Continuous detection**: ArgoCD drift detection, `terraform plan` on a schedule
3. **Auto-reconcile**: ArgoCD auto-sync repairs drift back to the desired state automatically
