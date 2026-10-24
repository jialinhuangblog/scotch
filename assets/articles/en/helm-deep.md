---
title: "Helm: a template engine for YAML, or a package manager?"
slug: helm-deep
date: 2026-03-14
updated: 2026-10-17
revisions: 1
subtitle: "The YAML for three environments differs by three lines. Someone changes one environment, forgets to sync another, and production breaks."
chapter: "devops"
tags: [helm, kustomize, k8s, devops, config-management]
related: [before-k8s, terraform-deep, deploy-practice]
---

# Helm: a template engine for YAML, or a package manager?

The YAML for three environments differs by three lines. Someone changes the staging ConfigMap and forgets to sync prod. One deploy on a Friday afternoon, and prod goes down.

A medium sized service has about 60 YAML files. Times three environments, that is 180. Every change has to be synced to three places, and missing one is an incident.

---

## Before Helm: how YAML was split per environment

### sed replacement

```bash
sed -i 's/IMAGE_TAG/v1.2.3/g' deployment.yaml
sed -i 's/REPLICA_COUNT/3/g' deployment.yaml
kubectl apply -f deployment.yaml
```

It works in simple cases, but it is fragile. `IMAGE_TAG` inside a comment gets replaced too. One typo breaks the whole YAML. There is no type check and no validation.

### Copy-paste per env

```
manifests/
  dev/
    deployment.yaml
    service.yaml
    configmap.yaml
  staging/
    deployment.yaml   ← 99% the same as dev
    service.yaml
    configmap.yaml
  prod/
    deployment.yaml   ← 99% the same as staging
    service.yaml
    configmap.yaml
```

This is the most obvious approach. `diff dev/deployment.yaml prod/deployment.yaml` gives this:

```diff
 apiVersion: apps/v1
 kind: Deployment
 metadata:
   name: my-app
 spec:
-  replicas: 1
+  replicas: 5
   template:
     spec:
       containers:
       - name: app
-        image: my-app:latest
+        image: my-app:v1.2.3
         env:
         - name: LOG_LEVEL
-          value: "debug"
+          value: "warn"
         - name: DB_HOST
-          value: "db-dev.internal"
+          value: "db-prod.internal"
```

30 lines of YAML, and only 4 differ. But what you maintain is two complete files. Three environments times 30 services is 90 nearly identical YAML files.

Three months later dev gains a new env var, and staging and prod do not follow. The differences pile up slowly. This is configuration drift. It has nothing to do with drift in cloud resources; it is drift between the team's own files.

### Writing your own script

```python
import yaml, sys

env = sys.argv[1]
config = yaml.safe_load(open(f"config/{env}.yaml"))
template = open("templates/deployment.yaml").read()
for key, value in config.items():
    template = template.replace(f"${{{key}}}", str(value))
print(template)
```

Every team writes its own version, each with a different format and logic. There is no shared standard, so changing teams means learning a new deploy script from the start.

---

## What Helm is

### Identity one: template engine

The core of a Helm chart is Go template. A `deployment.yaml` is no longer real YAML. It is a template:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}-app
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
      - name: app
        image: {{ .Values.image.repository }}:{{ .Values.image.tag }}
        resources:
          limits:
            memory: {{ .Values.resources.limits.memory }}
        env:
        {{- range .Values.env }}
        - name: {{ .name }}
          value: {{ .value | quote }}
        {{- end }}
```

The parameters live in `values.yaml`:

```yaml
replicaCount: 1
image:
  repository: my-app
  tag: v1.2.3
resources:
  limits:
    memory: 256Mi
env:
  - name: LOG_LEVEL
    value: debug
```

Three environments, three values files. `diff values-dev.yaml values-prod.yaml`:

```diff
-replicaCount: 1
+replicaCount: 5
 image:
   repository: my-app
-  tag: latest
+  tag: v1.2.3
 resources:
   limits:
-    memory: 256Mi
+    memory: 1Gi
 env:
   - name: LOG_LEVEL
-    value: debug
+    value: warn
+  - name: DB_HOST
+    value: db-prod.internal
```

The differences sit in one file instead of being scattered across three copies each of Deployment, Service and ConfigMap. Changing one line of values is enough. There is no YAML in three places to touch.

```bash
helm install my-app ./chart -f values-prod.yaml
```

### Identity two: package manager

To run Redis, you can write the Deployment + Service + ConfigMap + PersistentVolumeClaim yourself. Or do it in one line:

```bash
helm install redis bitnami/redis
```

The Bitnami chart handles every detail: the master-replica layout, sentinel, persistence, resource limits, security context.

A Helm chart is like an npm package. The public catalog Artifact Hub lists, for Helm alone, more than 18,000 ready made charts from more than 6,000 repos (October 2026 numbers), so there is no need to write the deployment config for every third party service from scratch.

### The full path of a chart from repo to cluster

Say you need to install a VPN gateway in EKS, and the vendor provides a Helm chart. The whole flow:

```bash
# 1. add the repo, which tells Helm where to find the chart
helm repo add acme-vpn https://acme-vpn.github.io/helm-charts/
helm repo update
```

`repo add` records the repo's name and URL, and at the same time downloads an `index.yaml`, the chart catalog, into the local cache. When the repo later publishes a new version, you run `repo update` to fetch `index.yaml` again from that URL. Only then does the local machine have a record of the new version.

```text
acme-vpn.github.io/helm-charts/
├── index.yaml                    ← Helm reads this
│     entries:
│       vpn-gateway:
│         - version: 2.1.0
│           urls: [vpn-gateway-2.1.0.tgz]
│
└── vpn-gateway-2.1.0.tgz        ← the archive
      untar → vpn-gateway/
              ├── Chart.yaml
              ├── values.yaml     ← defaults written by the chart author
              └── templates/
                  ├── deployment.yaml
                  ├── service.yaml
                  ├── serviceaccount.yaml
                  └── configmap.yaml
```

First look at what the defaults contain:

```bash
helm show values acme-vpn/vpn-gateway
```

```yaml
replicaCount: 1
image:
  repository: acme/vpn-gateway
  tag: "latest"
serviceAccount:
  create: true
  name: "acme-vpn"
env:
  - name: LICENSE_KEY
    value:              # empty, must be filled in at install time
  - name: GATEWAY_ENDPOINT
    value:              # empty, must be filled in at install time
```

The defaults are left empty on purpose. At install time you create a separate `values.yaml` with only the parts to override:

```yaml
# my-values.yaml, only the differences
serviceAccount:
  create: false         # use the existing SA, do not let the chart create a new one
env:
  - name: LICENSE_KEY
    value: "xxxx-xxxx"
  - name: GATEWAY_ENDPOINT
    value: "gw.acme-vpn.com:443"
```

It works like a CSS cascade. The chart defaults are the bottom layer, and the file given with `-f` is the override layer. Fields you leave out take the defaults.

```bash
# 2. install
helm upgrade -i dev-alice-vpn1 \
  -n acme-vpn \
  -f my-values.yaml \
  acme-vpn/vpn-gateway
```

| Flag | Meaning |
|---|---|
| `upgrade -i` | upgrade if it exists, install if it does not |
| `dev-alice-vpn1` | release name, a name you choose |
| `-n acme-vpn` | which namespace to install into |
| `-f my-values.yaml` | the override file |
| `acme-vpn/vpn-gateway` | repo / chart |

This command downloads the tgz and unpacks it, merges the chart's `values.yaml` with `my-values.yaml`, feeds the result into the Go template to produce the complete K8s YAML, and applies it to the cluster that kubeconfig points at.

**The release name isolates deployments by different people.** One namespace can hold several releases:

```bash
helm list -n acme-vpn

NAME               STATUS
dev-alice-vpn1    deployed
dev-bob-vpn1       deployed
dev-carol-vpn1     deployed
```

Each release is its own Deployment, Pods and config. Upgrading or deleting `dev-alice-vpn1` does not affect anyone else's release.

### Identity three: release manager

Every `helm install` or `helm upgrade` produces a release with a version number.

```bash
helm history my-app

REVISION  STATUS      DESCRIPTION
1         superseded  Install complete
2         superseded  Upgrade complete
3         deployed    Upgrade complete
```

Something broke?

```bash
helm rollback my-app 2
```

Back to revision 2. Helm stores a snapshot of each release (the rendered YAML) in a k8s Secret, so it knows what every version looked like.

---

## How complex a template gets before it is hard to read

### Simple: fill in one value

```yaml
replicas: {{ .Values.replicaCount }}
```

Clear at a glance. Put a number in values and you are done.

### Medium: add one condition

```yaml
{{- if .Values.ingress.enabled }}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ .Release.Name }}-ingress
{{- end }}
```

A condition decides whether this block of YAML is rendered. For example, prod needs an ingress and dev does not. One if handles it.

### Complex: conditions, loops and version checks stacked together

```yaml
{{- if and .Values.ingress.enabled (not .Values.ingress.className) }}
  {{- if .Capabilities.APIVersions.Has "networking.k8s.io/v1" }}
apiVersion: networking.k8s.io/v1
  {{- else }}
apiVersion: networking.k8s.io/v1beta1
  {{- end }}
{{- end }}
{{- with .Values.ingress.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
{{- end }}
{{- range .Values.ingress.hosts }}
  - host: {{ .host | quote }}
    http:
      paths:
        {{- range .paths }}
        - path: {{ .path }}
          pathType: {{ .pathType | default "ImplementationSpecific" }}
        {{- end }}
{{- end }}
```

At this level, what you debug is the Go template. Before you even reach a K8s or app problem, the time goes into finding out why the indent rendered wrong.

`helm template my-app ./chart` renders locally, which makes checking the output easier.

---

## [Kustomize](chunk://kustomize): no templates, only differences

Kustomize uses no templates. The base is YAML that can be applied as it is, and each environment stacks a small set of differences on top.

### Base + Overlay

The base folder holds complete YAML. You can run `kubectl apply` on it directly, with no rendering at all.

```yaml
# base/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: app
        image: my-app:latest
```

The overlay holds only the differences:

```yaml
# overlays/prod/patch-replicas.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 5
```

```yaml
# overlays/prod/kustomization.yaml
resources:
  - ../../base
patches:
  - path: patch-replicas.yaml
```

```bash
kubectl apply -k overlays/prod/
```

Kustomize merges base + patch. The final effect equals this diff:

```diff
 apiVersion: apps/v1
 kind: Deployment
 metadata:
   name: my-app
 spec:
-  replicas: 1
+  replicas: 5
   template:
     spec:
       containers:
       - name: app
         image: my-app:latest
```

The overlay describes only the differences. The base stays untouched. When you need the complete YAML, you compute it from the base plus the differences. This is much like a Git commit: the parent commit plus a diff is the new commit.

### The real difference from Helm

Helm's base is not valid YAML. `{{ .Values.replicaCount }}` is Go template syntax. It cannot go to `kubectl apply` directly; it must be rendered first.

Kustomize's base is valid YAML that anyone can read. The overlay is a strategic merge patch, also valid YAML.

### Where Kustomize is weak

Strategic merge patch handles most cases, but an array needs a merge key before one element in it can be changed precisely. The containers and env of a Deployment both have one, and they merge by the `name` field, so changing the value of one env var is fine. An array without a merge key, like `args`, does not work that way: the patch replaces the whole list of args. To change just one argument, you fall back to JSON patch:

```yaml
- op: replace
  path: /spec/template/spec/containers/0/args/2
  value: "--log-level=debug"
```

`/containers/0/args/2` means the third arg of the first container (the index starts at 0). The problem is that the index is fixed in the file. If someone adds an arg before it, every index after it shifts, and the patch points at the wrong place.

---

## Using Helm and Kustomize together

The two can split the work:

Third party services use Helm. The charts for Redis, Nginx Ingress and cert-manager are already written; customize them through values. Your own apps use Kustomize, because the differences between environments are small and the base can be read as it is.

They can even be chained:

```bash
helm template my-chart ./chart -f values-prod.yaml > overlays/prod/rendered.yaml
kubectl apply -k overlays/prod/
```

Helm renders the YAML and hands it to Kustomize for patching. `-k` accepts only a directory and does not read stdin, so the rendered output has to be written to a file first and then listed under `resources` in `overlays/prod/kustomization.yaml`.

---

## What Helm does not handle

Helm manages the resources inside k8s: Deployment, Service, ConfigMap.

But what about the k8s cluster itself?

VPC, Subnet, NAT Gateway, EKS cluster, Node Group, IAM Role, S3 Bucket, RDS.

None of these are k8s resources. They are the infrastructure under the cluster, and `kubectl apply` cannot reach them.

`helm install` assumes the cluster already exists. But who is responsible for making it exist?

If it is done by clicking in the AWS Console, you are back to the old problem of manual SSH: nobody can find out who changed what, and there is no way to build it again the same way. So infrastructure also has to go into version control, with a diff to look at and a review before apply.

---

## Who builds the cluster, and who runs helm upgrade

**[Terraform](chunk://terraform)** does declarative infra provisioning. You describe the end state (S3 bucket, VPC, EKS cluster), and Terraform computes the diff and executes it. But managing the state file is the biggest burden.

**[GitOps](chunk://gitops)** answers the question "who executes the Helm release". Today a person runs `helm upgrade`. With GitOps, the person commits the change to Git and ArgoCD syncs it automatically. People only review; they do not apply.
