---
title: "After you merge a PR, what happens before the Pod actually runs?"
slug: deploy-practice
date: 2026-03-15
updated: 2026-10-17
revisions: 1
subtitle: "Docker, Helm, Terraform and ArgoCD wired into one pipeline: what it actually looks like from push to a running Pod."
chapter: "devops"
tags: [gitops, argocd, helm, ci-cd, k8s, devops, deploy]
related: [gitops-deep, helm-deep, before-k8s, progressive-delivery]
---

# After you merge a PR, what happens before the Pod actually runs?

When you deploy a real app, how do Docker, Helm, Terraform and ArgoCD connect to each other?

The example below is one frontend plus two backends, followed from `git push` all the way to Pods running in three environments.

---

## Architecture: three services, three environments

```text
frontend (React)
    ↓ HTTP
api-server (Node.js)
    ↓ gRPC
user-service (Go)
```

Three environments: dev, staging, prod. One namespace per environment.

```text
dev     → namespace: myapp-dev      (1 replica each)
staging → namespace: myapp-staging  (2 replicas each)
prod    → namespace: myapp-prod     (5 replicas each)
```

---

## Repo layout: code and config kept apart

This example puts the app code and the k8s config in two repos.

```text
app-repo (code + CI)
├── frontend/
│   ├── src/
│   ├── Dockerfile
│   └── ...
├── api-server/
│   ├── src/
│   ├── Dockerfile
│   └── ...
├── user-service/
│   ├── main.go
│   ├── Dockerfile
│   └── ...
└── .github/workflows/
    └── ci.yaml          ← CI: build image, push to registry

config-repo (k8s manifests + Helm)
├── charts/
│   ├── frontend/
│   │   ├── Chart.yaml
│   │   ├── values.yaml          ← base defaults
│   │   ├── values-dev.yaml      ← dev overrides
│   │   ├── values-staging.yaml  ← staging overrides
│   │   ├── values-prod.yaml     ← prod overrides
│   │   └── templates/
│   │       ├── deployment.yaml
│   │       └── service.yaml
│   ├── api-server/
│   │   └── ...
│   └── user-service/
│       └── ...
└── argocd/
    ├── frontend-dev.yaml
    ├── frontend-staging.yaml
    ├── frontend-prod.yaml
    └── ...
```

Once they are separate, ArgoCD only watches config-repo, so code changes and CI builds in app-repo never trigger a sync.

---

## Helm: three layers of values overrides

The Helm chart's `values.yaml` holds the base defaults. Each environment overrides part of it with its own values file.

### Base values (values.yaml)

```yaml
replicaCount: 1

image:
  repository: myregistry.io/frontend
  tag: latest

service:
  type: ClusterIP
  port: 80

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 256Mi

env:
  - name: API_URL
    value: "http://api-server:8080"
```

### Dev overrides (values-dev.yaml)

```yaml
replicaCount: 1

image:
  tag: "dev-abc1234"

env:
  - name: API_URL
    value: "http://api-server:8080"
  - name: LOG_LEVEL
    value: "debug"
```

### Prod overrides (values-prod.yaml)

```yaml
replicaCount: 5

image:
  tag: "v2.1.0"

resources:
  requests:
    cpu: 500m
    memory: 512Mi
  limits:
    cpu: "2"
    memory: 1Gi

env:
  - name: API_URL
    value: "http://api-server:8080"
  - name: LOG_LEVEL
    value: "warn"
```

When prod is deployed across several regions, a third layer of region overrides goes on top.

```yaml
# values-prod-us.yaml
env:
  - name: CDN_ORIGIN
    value: "https://cdn-us.example.com"

# values-prod-asia.yaml
env:
  - name: CDN_ORIGIN
    value: "https://cdn-asia.example.com"
```

In ArgoCD, list several valueFiles. Later files override earlier ones:

```yaml
helm:
  valueFiles:
    - values.yaml           # base
    - values-prod.yaml       # environment
    - values-prod-us.yaml    # region
```

---

## Why the label appears three times in the Deployment YAML

The Deployment in the Helm template looks like this:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  labels:
    app: frontend          # ① the Deployment's own label
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app: frontend        # ② which Pods the Deployment manages
  template:
    metadata:
      labels:
        app: frontend      # ③ the label each Pod carries when created
    spec:
      containers:
      - name: frontend
        image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
```

The three `app: frontend` lines are written for different readers:

| Position | Who reads it | Purpose |
|---|---|---|
| ① `metadata.labels` | people, kubectl | lets `kubectl get deploy -l app=frontend` filter |
| ② `spec.selector.matchLabels` | Deployment controller | "I manage the Pods whose labels match this condition" |
| ③ `template.metadata.labels` | the Pod itself | the Pod carries this label once created, so ② can match it |

② and ③ must match, or the Deployment cannot find the Pods it created. The Service uses the same label to find Pods:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend
spec:
  selector:
    app: frontend          # find Pods whose label is app=frontend
  ports:
  - port: 80
    targetPort: 3000
```

---

## Service DNS: how the full name resolves

Inside a Pod, calling another Service only needs the Service name:

```typescript
const response = await fetch("http://api-server:8080/users");
```

k8s CoreDNS resolves `api-server` into the full FQDN (Fully Qualified Domain Name):

```text
api-server
  → api-server.myapp-prod.svc.cluster.local
  → ClusterIP (10.96.1.25)
  → kube-proxy iptables forwards to the actual Pod IP
```

| Short form | Full FQDN | When |
|---|---|---|
| `api-server` | `api-server.myapp-prod.svc.cluster.local` | same namespace |
| `api-server.myapp-staging` | `api-server.myapp-staging.svc.cluster.local` | across namespaces |

Within one namespace the short name is enough. Across namespaces, add the namespace name. `svc.cluster.local` usually does not need to be written; the search list in the Pod's `/etc/resolv.conf` (written by kubelet) fills it in.

---

## ArgoCD Application: three dimensions control what is watched

Each service in each environment maps to one ArgoCD Application:

```yaml
# argocd/frontend-prod.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: frontend-prod
  namespace: argocd
spec:
  source:
    repoURL: https://github.com/myorg/config-repo    # which repo
    targetRevision: main                               # which branch
    path: charts/frontend                              # which directory
    helm:
      valueFiles:
        - values.yaml
        - values-prod.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: myapp-prod
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

Three dimensions decide what ArgoCD watches:

| Dimension | Setting | Meaning |
|---|---|---|
| `repoURL` | which Git repo | config-repo, not app-repo |
| `targetRevision` | which branch/tag | main, develop, release/v2.1 |
| `path` | which directory | charts/frontend (charts/api-server is not watched) |

`helm.valueFiles` does not affect the watched scope. Any file change under path triggers a refresh (re-render and diff); a sync follows only if the rendered manifests changed. valueFiles only decides which values are used at render time.

### How dev and prod are kept apart

**Option one: same repo + branch, different ArgoCD Applications**

```yaml
# frontend-dev.yaml
spec:
  source:
    path: charts/frontend
    helm:
      valueFiles: [values.yaml, values-dev.yaml]
  destination:
    namespace: myapp-dev

# frontend-prod.yaml
spec:
  source:
    path: charts/frontend
    helm:
      valueFiles: [values.yaml, values-prod.yaml]
  destination:
    namespace: myapp-prod
```

Any change in `charts/frontend/` refreshes both environments, but only the one whose rendered output changed syncs: edit values-dev.yaml and the prod Application stays Synced. Fits a small team with all config on the main branch.

**Option two: different branches**

```yaml
# dev watches the develop branch
spec:
  source:
    targetRevision: develop
    helm:
      valueFiles: [values.yaml, values-dev.yaml]

# prod watches the main branch
spec:
  source:
    targetRevision: main
    helm:
      valueFiles: [values.yaml, values-prod.yaml]
```

A change on the develop branch triggers only dev. Merging to main triggers prod. One more layer of isolation, by branch.

**Option three: different repos**

```yaml
# dev
spec:
  source:
    repoURL: https://github.com/myorg/config-dev

# prod
spec:
  source:
    repoURL: https://github.com/myorg/config-prod
```

The two environments are fully isolated. Fits a team where prod changes need strict control.

---

## The full workflow: from merged PR to updated Pod

A developer changes the frontend code, pushes, opens a PR, merges. Everything after that is automatic.

### Step 1: CI builds the image

```yaml
# app-repo/.github/workflows/ci.yaml
name: CI
on:
  push:
    branches: [main]
    paths: ['frontend/**']

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build and push image
        run: |
          docker build -t myregistry.io/frontend:${{ github.sha }} frontend/
          docker push myregistry.io/frontend:${{ github.sha }}

      - name: Update config repo
        run: |
          git clone https://github.com/myorg/config-repo
          cd config-repo
          sed -i "s|tag:.*|tag: \"${{ github.sha }}\"|" charts/frontend/values-prod.yaml
          git add .
          git commit -m "ci: update frontend image to ${{ github.sha }}"
          git push
```

CI builds and pushes the image, then updates the image tag in config-repo. It never touches the cluster, so it needs no kubeconfig.

### Step 2: ArgoCD detects the config-repo change

```text
ArgoCD (polls every 3 minutes, or a webhook notifies it at once)
  ↓ detects a new commit on charts/frontend/values-prod.yaml
  ↓ helm template charts/frontend -f values.yaml -f values-prod.yaml
  ↓ compares the rendered YAML with the actual state on the cluster
  ↓ there is a diff (the image tag changed)
  ↓ sync
```

### Step 3: K8s rolling update

```text
Deployment frontend (prod)
  ↓ image goes from v2.1.0 → <sha>
  ↓ create a new Pod (<sha>)
  ↓ wait for the readiness probe to pass
  ↓ mark the old Pod (v2.1.0) terminating
  ↓ wait for graceful shutdown
  ↓ delete the old Pod
  ↓ repeat until all 5 replicas are updated
```

Zero downtime throughout. If the new Pod's readiness probe never passes, the rollout stops and the old version keeps serving.

### Step 4: ArgoCD keeps watching

```text
After the sync completes:
  ↓ status = Synced + Healthy (green)
  ↓ every 3 minutes, compare Git vs cluster
  ↓ someone ran kubectl edit and changed the replica count?
  ↓ selfHeal: true → change it back to the value in Git
```

---

## When something breaks, which layer to debug

Four tools are chained together. When something goes wrong, the first step is to work out which layer it is in:

| Symptom | Layer | How to check |
|---|---|---|
| CI did not run | CI (GitHub Actions) | read the Actions log |
| Image push failed | CI → Registry | try `docker pull` |
| ArgoCD shows OutOfSync | ArgoCD | view the diff in the ArgoCD UI |
| ArgoCD sync failed | Helm template render | run `helm template` locally and read the error |
| Pod CrashLoopBackOff | K8s / App | `kubectl logs`, `kubectl describe pod` |
| Pod Running but unreachable | Service / Network | `kubectl get endpoints`, confirm the labels match |
| Cluster will not come up | Terraform | run `terraform plan` and read the error |

The most common mistakes:
- Image tag typo, the Pod cannot pull the image → `ImagePullBackOff`
- Wrong indent in values.yaml, Helm renders invalid YAML → ArgoCD sync failed
- The Service selector label does not match the Pod label → endpoints are empty, connections time out

---

## What this example leaves out

**Progressive Delivery**: send 5% of traffic to the new version first, and widen it slowly once the metrics look normal, instead of switching everything at once. This is called a canary deploy. ArgoCD with Argo Rollouts can do it.

**Secret management**: the values.yaml in this article holds no secrets. In practice passwords and API keys go through Sealed Secrets or External Secrets Operator, never into Git in plain text. The approach is in [the GitOps article](article://gitops-deep).

**Multi-cluster**: this article assumes every environment is a different namespace in the same cluster. Large organizations use separate clusters. ArgoCD's ApplicationSet generates several Applications from one template, one per cluster.
