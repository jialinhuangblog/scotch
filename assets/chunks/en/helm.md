---
title: "Helm"
slug: helm
brief: "A k8s package manager built on Go templates. Templates remove repeated YAML, but once a template gets complex it is harder to read than the raw YAML."
date: 2026-03-14
article: helm-deep
---

# Helm

Once k8s YAML piles up, it starts repeating: three environments with almost the same deployment, and changing a few values means copying the whole file. Helm turns these YAML files into templates. The repeated part is written once; the parts that vary come in as parameters.

## What Helm does

**Template engine**

Go template syntax. One `deployment.yaml` template plus one `values.yaml` of parameters produces the final YAML. Three environments, three values files, one template.

```yaml
replicas: {{ .Values.replicaCount }}
image: {{ .Values.image.repository }}:{{ .Values.image.tag }}
```

**Package manager**

`helm install redis bitnami/redis`. Like npm, but what gets installed is a set of k8s resources. Public chart repos have thousands of existing charts.

**Release manager**

Every `helm install` or `helm upgrade` produces a release. `helm rollback my-app 3` goes back to revision 3.

## Tradeoff

A simple template reads well, but once it gets complex it is harder to understand than the raw YAML. At that point what you debug is often Go template syntax, not k8s itself.

The alternative, **Kustomize**, uses no templates. It uses overlay patches instead: the base is a real YAML file that runs as is, and each environment adds a patch that writes only the fields to change. Compare the two on one change, "set replicas from 1 to 3":

```yaml
# Helm: the base holds a placeholder parameter, values.yaml fills it in
replicas: {{ .Values.replicaCount }}

# Kustomize: the base is complete YAML
# base/deployment.yaml
replicas: 1
# overlays/prod/patch.yaml: only the line to override
replicas: 3
```

The two are not mutually exclusive. You can render YAML with Helm first, then patch it with Kustomize.
