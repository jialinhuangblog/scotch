---
title: "GitOps"
slug: gitops
brief: "The cluster's state follows Git. An agent inside the cluster pulls changes from Git and applies them; the pipeline does not push deployments."
date: 2026-03-14
updated: 2026-10-18
revisions: 2
article: gitops-deep
---

# GitOps

What state the cluster should be in follows the manifests in Git. To change the cluster, change Git.

## Push vs Pull

Traditional CI/CD is push: the pipeline builds the image, then runs `helm upgrade` or `kubectl apply` itself, holding the cluster's kubeconfig. The cluster credential sits in the CI secrets.

GitOps is pull. Walk through one release: an engineer changes the image tag in `deploy/api.yaml` from `api:1.4` to `api:1.5`, opens a PR, merges it into main. An agent (ArgoCD or Flux) runs inside the cluster and fetches this repo every few minutes. It sees a new commit on main, renders the manifests, compares them with the Deployment currently in the cluster, finds one image tag different, and applies it. The pipeline only builds the image and pushes it to the registry; it never touches the cluster.

## Why pull is better

1. **Security**: there is no kubeconfig in the CI secrets. If CI is compromised, the attacker holds push rights to the registry and cannot run `kubectl` against the cluster directly. But the attacker can still push their own image as `api:1.5`, overwriting the original tag. Later, when a Pod is scheduled onto a new node that has not pulled this image yet, that node pulls the attacker's version and runs it. To prevent this, the registry has to make tags immutable (ECR's immutable tags, for example), or the manifest pins the image by digest (`api@sha256:...`) instead of a tag.
2. **Drift detection**: on every pass the agent compares "what the cluster looks like now" against "what Git says it should look like". Someone runs `kubectl scale deploy api --replicas=5` at night to handle an incident, while Git says 3. On the next pass the agent sees 5 against 3, marks the app OutOfSync, and can raise a warning. In ArgoCD, auto-sync alone does not change it back, because auto-sync syncs only when the content in Git changes, and a manual change on the cluster does not trigger it. With selfHeal also turned on, ArgoCD changes the cluster back to 3. This gap is called drift, and without the agent nobody notices it until the next deploy.
3. **Consistent with the k8s philosophy**: k8s is itself a reconciliation loop; GitOps only extends the source of desired state from etcd to Git.

## Tools

ArgoCD and Flux are the two most common GitOps controllers. Both run inside the cluster, watch Git, and reconcile. ArgoCD ships with a UI dashboard. Flux has no UI of its own and is driven mainly from the CLI; for a graphical interface you install a tool such as Capacitor separately.
