---
title: "ArgoCD"
slug: argocd
brief: "A GitOps controller native to k8s. It watches a Git repo, diffs it against the cluster, and syncs automatically."
date: 2026-03-14
updated: 2026-10-18
revisions: 4
article: gitops-deep
---

# ArgoCD

A controller that runs inside k8s, watches a Git repo, and makes sure the cluster matches Git.

## The Application CRD

ArgoCD describes what to deploy with a Custom Resource called Application:

```yaml
source:
  repoURL: https://github.com/my-org/k8s-manifests
  path: apps/my-service
  targetRevision: main
destination:
  server: https://kubernetes.default.svc
  namespace: production
```

It names the Git repo + path + target cluster. ArgoCD pulls Git on a schedule and compares it with the cluster's actual state.

## Sync

CI changes the image tag in `apps/my-service/deployment.yaml` in the manifest repo from `api:a81d0b7` to `api:3f9c2e1` and commits it to main. ArgoCD pulls the repo every 3 minutes by default, picks up the new commit, and works out that Git wants `3f9c2e1` while the cluster runs `a81d0b7`. The Application becomes OutOfSync.

- **OutOfSync** — Git and the cluster differ. The UI shows yellow.
- **Synced** — they match. Green.
- **Auto-sync** — apply automatically as soon as a diff is detected. With it on, ArgoCD applies the new Deployment itself, and once the spec on the cluster matches Git, the state returns to Synced green. With it off, it is manual sync, and the yellow stays until someone presses the button.

Synced only compares manifests. Whether the rolling update has finished is a separate status called health. Right after the apply, while the new Pods are still starting, the UI shows Synced plus Progressing; health turns Healthy only when every Pod of the Deployment runs the new version. If the new Pods keep hitting CrashLoopBackOff, the UI stays at Synced plus Progressing, and turns Degraded only after the Deployment passes its progress deadline. So Synced means the manifest in Git has reached the cluster. Whether the new version is serving traffic is what health tells you.

## Drift detection

Someone changes the replica count from 3 to 5 by hand with `kubectl edit`. Git still says 3, so ArgoCD finds it on the next diff and the Application turns OutOfSync again. With auto-sync plus selfHeal, it sets the cluster straight back to 3. Git is the source of truth for ArgoCD, so a manual change on the cluster counts as drift.

A traditional pipeline pushes once and does nothing after. ArgoCD keeps monitoring.
