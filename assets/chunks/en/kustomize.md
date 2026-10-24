---
title: "Kustomize"
slug: kustomize
brief: "k8s configuration by overlay. Patch real YAML, with no template syntax."
date: 2026-03-14
article: helm-deep
---

# Kustomize

Kustomize patches existing YAML. There is no template anywhere in it.

## Base + Overlay

The base folder does not hold templates. It holds complete YAML that you can `kubectl apply` directly.

The overlay folder writes only the differences. The production overlay sets replicas from 1 to 5 and the image tag to stable.

```
base/
  deployment.yaml    ← real YAML, replica: 1
  service.yaml
overlays/
  prod/
    kustomization.yaml
    patch-replicas.yaml  ← only replica: 5
```

When you run `kubectl apply -k overlays/prod/`, Kustomize merges the base with the patch and produces the final YAML.

## vs Helm

Helm's template is `{{ .Values.x }}`. Kustomize's base is real YAML, readable without knowing any template syntax.

Helm fits charts from third parties (Redis, Nginx Ingress), because parameterization gives a lot of flexibility. Kustomize fits your own apps where environments differ little and readability matters more.
