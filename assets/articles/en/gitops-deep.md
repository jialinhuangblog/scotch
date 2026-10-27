---
title: "How GitOps keeps the cluster in sync with Git"
slug: gitops-deep
date: 2026-03-14
updated: 2026-10-17
revisions: 1
subtitle: "'Which version is on prod?' Often nobody can answer. ArgoCD keeps comparing Git with the cluster, and the version gap between the two shows up right in its UI."
chapter: "devops"
tags: [gitops, argocd, ci-cd, drift, sealed-secrets, devops]
related: [terraform-deep, before-k8s, deploy-practice, progressive-delivery]
---

# How GitOps keeps the cluster in sync with Git

The team lead asks: "Which version is running on prod?"

Run `kubectl get deployment my-app -o jsonpath='{.spec.template.spec.containers[0].image}'`. It returns `my-app:v1.4.2`.

But the YAML in the Git repo says `v1.4.1`.

Someone updated it by hand with `kubectl set image`. No PR, no commit, so the real state of prod no longer matches Git. Who changed it, and why, is recorded nowhere.

This is [drift](chunk://drift). Here it means k8s drift (the app layer), which is different from Terraform drift (the infra layer).

---

## Before GitOps: Push-based Deploy

The traditional [CI/CD](chunk://ci-cd) pipeline:

```
Developer merge PR
    → CI pipeline triggers
    → Build Docker image
    → Push to container registry
    → helm upgrade my-app --set image.tag=v1.4.2
    → deploy done
```

The pipeline **pushes** to the cluster. This is push-based deploy.

### The problems with push

**The pipeline needs a cluster credential.** The CI runner has to hold a kubeconfig or a service account token before it can `kubectl apply`. A compromised CI runner = a compromised cluster. The attack surface is large.

**Push, then stop watching.** The pipeline finishes and shows "Deploy succeeded". But the pipeline does not keep monitoring. If someone changes the cluster by hand, the pipeline never notices.

**Git and the cluster can diverge.** The pipeline pushes the YAML as it was at that moment. Later someone changes the cluster by hand, and Git still holds the old version. On the next pipeline run, the version in Git overwrites the manual change. If that manual change was a hotfix, it gets overwritten, and nobody notices.

### The root problem

k8s is pull-based. Controllers watch the API server, and when the desired state changes they act. This is the [reconciliation](chunk://reconciliation) loop, the core design of k8s.

Traditional CI/CD is push-based: the pipeline pushes into the cluster. That is the opposite direction from k8s.

GitOps makes deploy pull-based too.

---

## The core principles of GitOps

**1. Git is the only source of truth.** Cluster state, CI pipeline output, someone's terminal: none of them count. The YAML (or [Helm](chunk://helm) values) in the Git repo = desired state.

**2. Every change goes through Git.** To change replicas, change the YAML in Git, open a PR, review, merge. No `kubectl edit`, no `helm upgrade --set`.

**3. An agent inside the cluster pulls.** The agent (ArgoCD/Flux) runs inside the cluster and watches the Git repo. New commit in Git → agent detects the diff → sync. The pipeline never pushes to the cluster directly.

**4. Continuous reconciliation.** The agent does not run once and stop. It compares Git and the cluster on a schedule. On drift it notifies, or repairs automatically.

---

## ArgoCD: a k8s-native GitOps Controller

ArgoCD runs inside the cluster as a k8s controller. What it watches is not only the API server but the Git repo.

### The Application CRD

ArgoCD uses the Application CRD to describe where a deployment comes from and where it goes:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: my-app
  namespace: argocd
spec:
  source:
    repoURL: https://github.com/my-org/k8s-manifests
    path: apps/my-service
    targetRevision: main
  destination:
    server: https://kubernetes.default.svc
    namespace: production
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

- `source`: which path in which Git repo
- `destination`: which namespace in which cluster to deploy to
- `syncPolicy.automated.selfHeal: true`: if someone changes the cluster by hand, change it back to the Git version automatically

### Sync Loop

ArgoCD pulls the Git repo every 3 minutes (the default). A webhook can also be set, so a Git push notifies ArgoCD right away.

```
Git repo (desired) ←──── ArgoCD compares ────→ Cluster (actual)
                              ↓
                    Different? Sync. Same? Do nothing.
```

### Sync status

- **Synced**: Git and the cluster match. Green.
- **OutOfSync**: they do not match. Yellow. Either Git has a new commit not yet synced, or someone changed the cluster by hand.

Besides sync status, ArgoCD has a separate Health column. Degraded belongs to the Health column:

- **Degraded**: synced, but the resource is unhealthy (Pod CrashLoopBackOff). Red.

### Drift Detection

Someone runs `kubectl edit deployment my-app` and changes replicas from 3 to 5.

Traditional CI/CD never notices. It waits until the next pipeline run, which uses the YAML in Git to overwrite replicas back to 3.

ArgoCD finds it on the next sync loop: the cluster has replicas = 5 but Git says 3. With `selfHeal` on, it changes it back to 3 automatically. Without it, the UI turns yellow to notify.

### Bootstrap: who deploys ArgoCD?

ArgoCD manages every deployment, but it cannot deploy itself. The first step is manual.

```
1. helm install argocd        ← manual
2. kubectl apply root-app.yaml ← manual, create a few "root" Applications, the only kubectl apply you ever run
3. ArgoCD takes over           ← fully automatic from here
```

A root Application points at the directory in the Git repo that holds Application definitions. When ArgoCD scans that directory and finds a new YAML, it creates a child Application automatically. Each child Application then syncs the real workload.

### App of Apps

The whole cluster's deployments unfold from one root Application:

```
root Application (created by hand)
├── infra-apps    → watches the repo/applications/ directory
│   ├── fluentd   → helm/fluentd/ + values.yaml  → efk namespace
│   ├── istio     → helm/istio/                   → istio-system namespace
│   └── prometheus→ helm/prometheus/               → monitoring namespace
└── app-projects  → watches the repo/projects/ directory
    └── ...       → manages ArgoCD Project permissions
```

Only the top few root Applications are created by hand. After that, adding a YAML file to the Git repo equals adding a deployment. Deleting the YAML equals taking it down.

### Helm + ArgoCD

ArgoCD supports a Helm chart as a source natively. `spec.source.helm` in the Application names the values files:

```yaml
source:
  helm:
    releaseName: fluentd
    valueFiles:
      - values.yaml            # chart defaults
      - dev-eks.yaml           # overrides for this cluster
  path: helm/fluentd
  repoURL: https://github.com/my-org/argocd
  targetRevision: main
```

ArgoCD reads `values.yaml` first, overlays `dev-eks.yaml`, renders the final manifest, and applies it to the cluster. Change a values file, push to Git, and ArgoCD re-renders and syncs automatically.

---

## The full deploy flow

### Before (the manual era)

```
Developer: write code → push → build by hand → scp to server → ssh and restart
```

### Middle (CI/CD without GitOps)

```
Developer: merge PR
    → CI: build image, push to registry
    → CD: helm upgrade / kubectl apply (pipeline pushes)
    → push, then stop watching
```

### After (GitOps)

```
Developer: merge PR
    → CI: build image, push to registry, update values.yaml image tag, commit
    → ArgoCD: detect Git change → diff → sync to cluster
    → k8s: reconciliation loop → rolling update new pods
    → ArgoCD: keeps monitoring, notifies/repairs on drift
```

The only human work is reviewing and merging the PR. Automation does the rest.

### Dividing the work between CI and CD

```
CI Pipeline (GitHub Actions)        ArgoCD (inside the cluster)
─────────────────────────           ──────────────────────
1. Pull code                        1. Watch Git repo
2. Run tests                        2. Detect new commit
3. Build Docker image                3. Diff Git vs cluster
4. Push image to registry            4. Sync (kubectl apply)
5. Update the image tag in Git       5. Keep monitoring for drift
6. Commit & push
```

The CI pipeline **never touches the cluster**. It only builds the image and updates Git. The deploy is ArgoCD pulling from Git on its own.

So the CI runner needs no cluster credential like a kubeconfig. Even a compromised runner cannot reach the cluster.

---

## GitOps for Terraform: Atlantis

ArgoCD manages k8s. The matching tool for Terraform is Atlantis:

1. A developer opens a PR that changes `.tf` files
2. The Atlantis bot runs `terraform plan` in the PR automatically
3. The plan result is posted as a comment on the PR, so the reviewer reads the diff right there
4. The reviewer approves and comments `atlantis apply`
5. Atlantis runs `terraform apply`

```
PR comment:

Plan: 2 to add, 1 to change, 0 to destroy.

+ aws_s3_bucket.new_assets
~ aws_security_group.web (1 rule change)
```

Same flow as ArgoCD: humans review, machines execute.

But Terraform GitOps is more dangerous than k8s GitOps. `terraform apply` calls cloud APIs directly. It can delete a VPC or change an IAM policy. A deleted k8s Pod rebuilds itself. A VPC deleted by Terraform does not come back. So on the Terraform side the apply stays manual (a person presses the button in the PR), and auto-apply stays off.

---

## What about Secrets

GitOps wants every setting in Git. But a Secret cannot sit in Git as plaintext.

### A k8s Secret is not encrypted

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
data:
  password: cGFzc3dvcmQxMjM=   # base64("password123")
```

Base64 is not encryption. Anyone can run `echo cGFzc3dvcmQxMjM= | base64 -d` and read the plaintext. Putting this YAML in Git = publishing the password.

### Fix one: Sealed Secrets

Bitnami Sealed Secrets. A controller runs inside the cluster and holds the private key.

```bash
kubeseal --format yaml < secret.yaml > sealed-secret.yaml
```

The SealedSecret YAML it produces is encrypted and can go in Git. After ArgoCD syncs it to the cluster, the controller decrypts it with the private key and produces the real k8s Secret.

The private key exists only inside the cluster, so even a ciphertext leaked from Git cannot be decrypted.

### Fix two: External Secrets Operator

The Secret is never stored in Git at all.

```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: db-credentials
spec:
  secretStoreRef:
    name: aws-secrets-manager
  target:
    name: db-credentials
  data:
  - secretKey: password
    remoteRef:
      key: production/db/password
```

The ExternalSecret is a declaration: "fetch `production/db/password` from AWS Secrets Manager and create a k8s Secret from it."

Git holds only a pointer to the secret, not the secret itself. ArgoCD syncs the ExternalSecret → the Operator fetches from Secrets Manager → the k8s Secret is created.

### Fix three: SOPS

Mozilla SOPS. It uses AWS KMS or GCP KMS to encrypt the values inside the YAML (not the whole file).

```yaml
password: ENC[AES256_GCM,data:abc123...,type:str]
```

With the SOPS plugin installed, ArgoCD decrypts automatically during sync.

---

## The cost of GitOps

### The learning curve

One deploy involves four layers of tools:

```
Terraform → infra
Helm → k8s resource templates
ArgoCD → GitOps sync
k8s → container runtime
```

When something breaks, the first job is finding which layer broke. It could be a failed Terraform plan, a Helm template that renders wrong, an ArgoCD sync that is stuck, or a Pod stuck in CrashLoopBackOff. Each layer is debugged differently, so a newcomer has to learn four toolsets at once.

### Latency

Git push → ArgoCD detect → sync. The default is 3 minute polling, not instant. A webhook shortens it, but not to zero.

In a hurry to deploy a hotfix, you can press sync by hand in the ArgoCD UI. But that bypasses the GitOps flow. If the hotfix is not committed to Git, the next sync overwrites it.

### Rollback goes through git revert

ArgoCD has a rollback command that returns to a version deployed earlier. But an Application with automated sync on cannot use it, and the `selfHeal: true` example above is exactly that kind. Also, rollback does not touch Git. Git still holds the new version. So rollback goes through Git as well:

1. `git revert` that commit
2. Push
3. ArgoCD detects → syncs → deploys the old version

### Repo strategy

App code and k8s manifests in the same repo? Or separate?

**Monorepo** keeps code and deploy config in the same PR. Simple and direct. But CI build and ArgoCD sync are tied together, and a code change triggers syncs that were not needed.

**Separate repos** split into an App repo (code + CI) and a Config repo (Helm values + [Kustomize](chunk://kustomize) overlays). After the build, CI pushes the image tag to the Config repo, and ArgoCD watches only the Config repo. A commit to the App repo does not trigger a sync directly, but one change may need a PR in each of the two repos.

---

## Looking back along the chain

From the first article to here:

```
Before:  SSH → deploy by hand → a machine dies, a person goes to fix it
         ↓
         problem: inconsistent environments, snowflake servers
         ↓
Container: Docker packages everything → environment problem solved
         ↓
         problem: ten machines, who manages the containers?
         ↓
k8s:     declarative + reconciliation → machines manage containers
         ↓
         problem: 180 YAML files, three environments edited by hand
         ↓
Helm:    templating → YAML duplication solved
         ↓
         problem: who builds the cluster itself? infra is not YAML
         ↓
Terraform: declarative infra → VPC/EKS/S3 are all code
         ↓
         problem: who runs terraform apply? who runs helm upgrade? a person.
         ↓
GitOps:  Git commit = deploy. ArgoCD pulls + reconciles.
         Humans only review. Machines execute.
```

That 3am phone call at the start of the first article used to mean SSH in and restart the process. Now when a Pod dies, k8s rebuilds it. When someone changes the cluster by hand, ArgoCD changes it back to the Git version.

---

## What automated sync does not cover

**Progressive Delivery**, which includes canary deploy, blue-green deploy and A/B testing. ArgoCD + Argo Rollouts can do canary: send 5% of traffic to the new version first, and switch all of it over once the metrics look normal.

**Policy as Code**, for example OPA/Gatekeeper. Gatekeeper is a validating admission webhook on the API server, so the apply inside an ArgoCD sync runs into it: "Does this Deployment set a resource limit? Does it use the latest tag?" An object that fails the policy never enters the cluster and the sync fails. To stop it before the sync, use conftest in CI or a PreSync hook.

**Multi-cluster** management. ArgoCD can manage several clusters, with one Application deployed to the dev, staging and prod clusters. An ApplicationSet can generate those Applications automatically.
