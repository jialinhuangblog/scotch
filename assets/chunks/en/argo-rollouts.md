---
title: "Argo Rollouts"
slug: argo-rollouts
brief: "A progressive delivery controller native to k8s. It replaces Deployment and adds canary and blue-green strategies."
date: 2026-04-02
article: progressive-delivery
---

# Argo Rollouts

The native k8s Deployment only does rolling updates. Argo Rollouts is a CRD plus a controller that replaces Deployment and supports canary and blue-green.

## The Rollout CRD

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: my-app
spec:
  strategy:
    canary:
      steps:
        - setWeight: 5
        - pause: { duration: 5m }
        - setWeight: 20
        - pause: { duration: 5m }
        - setWeight: 50
        - pause: { duration: 5m }
        - setWeight: 100
```

`setWeight: 5` sends 5% of traffic to the new version. `pause` waits 5 minutes to observe. The weight climbs step by step to 100%.

## AnalysisRun

A human watching a dashboard reacts too slowly. An AnalysisRun queries Prometheus metrics automatically:

```yaml
- setWeight: 20
- analysis:
    templates:
      - templateName: error-rate-check
    args:
      - name: service-name
        value: my-app
```

An AnalysisTemplate defines the query: "was the error rate over the last 5 minutes below 1%?". Pass and the rollout continues; fail and it rolls back automatically.

## Relationship with ArgoCD

ArgoCD syncs the Rollout CRD from Git into the cluster. The Rollouts controller then takes over, runs the canary or blue-green strategy, and controls the traffic.
