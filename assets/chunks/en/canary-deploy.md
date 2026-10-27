---
title: "Canary Deployment"
slug: canary-deploy
brief: "Send 5% of traffic to the new version first, and widen to all of it once metrics look normal. If something breaks, only 5% of users are affected."
date: 2026-04-02
article: progressive-delivery
---

# Canary Deployment

A rolling update replaces every replica with the new version one by one as soon as the readiness probe passes. If the app has a logic bug that raises the error rate, the rolling update does not notice. You find out only after every replica has been replaced.

Canary splits "deploy the new version" and "route traffic to the new version" into two steps.

## Flow

```
deploy new version Pods (but give them no traffic)
  → shift 5% of traffic to the new version
  → watch error rate, latency, 5xx
  → numbers normal → 20% → 50% → 100%
  → numbers abnormal → switch back to the old version automatically
```

Traffic splitting relies on weighted routing from a Service Mesh (Istio) or an Ingress controller. The native k8s Service cannot split by percentage, because kube-proxy in iptables mode picks a Pod at random, so the share of traffic the new version gets is decided only by the Pod count.

## Difference from Rolling Update

| | Rolling Update | Canary |
|---|---|---|
| Traffic control | none; a new Pod gets traffic as soon as it is ready | percentage ramps up |
| Rollback trigger | manual, or a failed probe | metrics gate decides automatically |
| Scope of impact | gradual but no metrics gate | at most 5% (depends on settings) |
| Extra tooling | none | Argo Rollouts or Flagger |
