---
title: "Pod ready does not mean user traffic goes to it"
slug: progressive-delivery
date: 2026-04-02
updated: 2026-10-17
revisions: 1
subtitle: "The rolling update swapped every Pod. But the app has a logic bug, error rate went from 0.1% to 5%, and nobody reported it until the next morning."
chapter: "devops"
tags: [progressive-delivery, canary, blue-green, argo-rollouts, argocd, devops]
related: [deploy-practice, gitops-deep]
---

# Pod ready does not mean user traffic goes to it

[The previous article](article://deploy-practice) went from merging the PR all the way to the Pod running. After the ArgoCD sync and the Helm render, the k8s rolling update replaced the five replicas one by one with the new version, and ArgoCD showed green.

The next morning, reports start coming in on Slack: error rate jumped from 0.1% to 5%. The new version has an edge case. One API returns 500 for a specific payload. The readiness probe checks `/healthz`, not that API, so the probe kept passing and the rolling update replaced all five Pods as usual.

The rolling update rule is: once a new Pod is ready, kill one old Pod. Ready means the readiness probe passed. But the probe only checks whether the Pod is alive. It cannot check whether the business logic is correct.

Progressive delivery fills this gap. The new version first receives only a small share of traffic, and the share grows only while the metrics stay normal.

---

## What a Rolling Update does, and what it does not

```
Deployment replicas=5, image: v1 → v2

1. create 1 v2 Pod
2. readiness probe passes
3. v2 Pod joins the Service endpoints
4. kill 1 v1 Pod
5. repeat until all 5 are v2
```

The whole process takes tens of seconds to a few minutes. k8s `maxSurge` and `maxUnavailable` control how many are swapped at a time, but however you tune them the core logic stays the same: probe passes, swap.

A rolling update lacks these mechanisms:

- **Traffic percentage control.** A new Pod receives traffic as soon as it is ready. The share is set by the Pod count. There is no way to say "5% first".
- **Metrics gate.** Nothing watches error rate or latency before deciding whether to continue.
- **Automatic rollback.** A probe failure stops the update, but a business problem after the probe passes never triggers a rollback.

---

## Canary: send a small share of traffic to the new version first

The [Canary](chunk://canary-deploy) idea comes from the canary in the coal mine. Miners carried a canary down the mine. The canary died first, and the miners knew there was poison gas.

Canary deployment follows the same logic: a small group of users meets the new version first. If the new version has a problem, only that small group is affected.

### How traffic is split

A native k8s Service spreads traffic evenly over all Pods. kube-proxy's default iptables mode picks a random Pod per connection, and IPVS mode defaults to round-robin. Over time both come out even. With 1 new Pod out of 5, the share is 20%. There is no way to set it to 5%.

Precise percentage splitting needs a layer above the Service:

**Istio VirtualService:**

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
spec:
  http:
    - route:
        - destination:
            host: my-app
            subset: stable
          weight: 95
        - destination:
            host: my-app
            subset: canary
          weight: 5
```

Istio puts an Envoy sidecar proxy in every Pod. The sidecar intercepts traffic and sends 95% to the stable Pods and 5% to the canary Pods. This is [L7 traffic control](chunk://l4-vs-l7-lb).

**Alternatives without Istio:** Nginx Ingress Controller also supports a canary annotation. Or use an AWS ALB weighted target group. But Istio is the most common pairing, because [Argo Rollouts](chunk://argo-rollouts) integrates with Istio natively.

### The problem with manual canary

Doing canary by hand: deploy the new Pods, change the VirtualService weight, watch the dashboard for five minutes, change the weight, watch for another five minutes. A hotfix at 3am also needs someone watching.

---

## Argo Rollouts: automated progressive delivery

Argo Rollouts is a k8s CRD plus a controller. It introduces a new resource type, `Rollout`, which can replace a `Deployment` or, since 1.0, point at an existing one through `workloadRef`.

### The Rollout CRD

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: my-app
spec:
  replicas: 5
  strategy:
    canary:
      canaryService: my-app-canary
      stableService: my-app-stable
      trafficRouting:
        istio:
          virtualService:
            name: my-app-vsvc
            routes:
              - primary
      steps:
        - setWeight: 5
        - pause: { duration: 5m }
        - setWeight: 20
        - pause: { duration: 5m }
        - setWeight: 50
        - pause: { duration: 10m }
        - setWeight: 100
  template:
    spec:
      containers:
        - name: my-app
          image: myregistry.io/my-app:v2
```

`steps` lists every step of the rollout. `setWeight: 5` makes Argo Rollouts change the Istio VirtualService weight and route 5% of traffic to the canary Pods. `pause` waits 5 minutes. Then 20%, 50%, 100%.

Nobody needs to watch a dashboard and change the weight by hand in between.

### How it connects to ArgoCD

ArgoCD syncs the Rollout YAML from Git to the cluster. The Argo Rollouts controller runs the canary steps.

```
Git (Rollout YAML)
  → ArgoCD sync → kubectl apply Rollout
  → Rollouts controller takes over
  → setWeight 5 → pause → setWeight 20 → ...
```

ArgoCD's job ends at `kubectl apply`. Traffic control, pause and rollback after that belong to the Rollouts controller. The two do not interfere with each other.

---

## AnalysisRun: let metrics decide whether to continue

But what happens after the 5 minute pause? If nobody is watching the dashboard, the rollout continues as soon as the pause ends (raising the new version's traffic share). That is almost the same as no canary at all.

AnalysisRun is the metrics gate of Argo Rollouts. At every pause stage it queries Prometheus (or Datadog, New Relic) by itself, and the result decides whether to continue or roll back.

### AnalysisTemplate

An AnalysisTemplate is a query template. The Rollout references it by name:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: error-rate-check
spec:
  args:
    - name: service-name
  metrics:
    - name: error-rate
      interval: 1m
      successCondition: result[0] < 0.01
      provider:
        prometheus:
          address: http://prometheus:9090
          query: |
            sum(rate(http_requests_total{service="{{args.service-name}}",status=~"5.."}[5m]))
            /
            sum(rate(http_requests_total{service="{{args.service-name}}"}[5m]))
```

`successCondition: result[0] < 0.01` means a 5xx rate below 1% passes. `interval: 1m` queries once a minute.

### Adding Analysis to the Rollout

```yaml
steps:
  - setWeight: 5
  - pause: { duration: 2m }
  - analysis:
      templates:
        - templateName: error-rate-check
      args:
        - name: service-name
          value: my-app
  - setWeight: 20
  - pause: { duration: 2m }
  - analysis:
      templates:
        - templateName: error-rate-check
      args:
        - name: service-name
          value: my-app
  - setWeight: 100
```

The flow becomes:

```
setWeight 5
  → pause 2 minutes (let traffic settle)
  → AnalysisRun starts querying Prometheus
  → error rate < 1%?
    → yes → continue to setWeight 20
    → no → automatic rollback, all traffic back to stable
```

The whole rollout, from deploy to taking all traffic, can take 15-20 minutes, much slower than a rolling update. But when the new version has a problem, at most 5% of users are affected, and the rollback happens without waiting for a human to react.

### What happens when Analysis fails

The Rollouts controller kills the canary Pods and switches the VirtualService weight back to 100% stable. The Rollout status becomes `Degraded`. The ArgoCD UI shows red.

A Slack notification can be attached as well: AnalysisRun failed, rollback complete, with the Prometheus query result. What oncall sees in the morning is a notice that the rollback already finished, not an incident still in progress and waiting for someone.

---

## Blue-Green: switch all traffic at once

Canary raises traffic step by step. [Blue-green](chunk://blue-green-deploy) switches all of it in one move.

### How it works

Two complete Pod groups run at the same time. Blue is production, Green is the new version.

```
Blue (v1): 5 Pods ← activeService points here (100% traffic)
Green (v2): 5 Pods ← previewService points here (internal testing)
```

Once Green is deployed, run the smoke tests. If they pass, switch activeService to Green.

```
Blue (v1): 5 Pods ← no traffic, but still alive
Green (v2): 5 Pods ← activeService points here (100% traffic)
```

If something goes wrong, switch activeService back to Blue. Blue's Pods are all still there, so the rollback takes seconds.

### Blue-Green in Argo Rollouts

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
spec:
  strategy:
    blueGreen:
      activeService: my-app-active
      previewService: my-app-preview
      autoPromotionEnabled: false
      prePromotionAnalysis:
        templates:
          - templateName: smoke-test
      scaleDownDelaySeconds: 600
```

Once all Green Pods are ready, prePromotionAnalysis runs smoke-test first. If it passes, the rollout pauses because of `autoPromotionEnabled: false` and waits for someone to promote it by hand. The promote switches activeService to Green. `scaleDownDelaySeconds: 600` keeps the old Pods alive for 10 more minutes, so the new version can be confirmed stable before they are killed.

### The cost

Resources double during the deploy. A service with 5 Pods becomes 10 under blue-green. Only after the switch and the stability check can the old version be killed.

The bigger problem is database migration. Blue and Green share the same DB. If Green ran a schema migration (added a column, changed a type), Blue's code may not be able to read the new schema when traffic switches back. So blue-green with DB migrations has to follow the expand-and-contract pattern: add the new column first (both Green and Blue can run), then clean up the old column later.

---

## Which one when

### Rolling Update

Internal services, features that are not core, or services with high enough test coverage: a rolling update is enough. Deploys are fast and need no extra tooling.

If the readiness probe is designed well (it checks the DB connection, dependency health), most deploy problems stop at the probe step.

### Canary

Paths that face the user, where a failure costs revenue, like payment, checkout and login. There, a passing probe is not enough. The traffic share grows only once the metrics look normal.

The precondition is good observability. The canary metrics gate queries Prometheus. If Prometheus has no error rate metric at all, the gate has no number to judge by.

### Blue-Green

Fits systems that need instant rollback, such as a financial system where regulation requires rollback within N seconds. It also fits a large migration where the full smoke test has to pass before the switch.

The cost is resources. If prod runs 50 Pods, blue-green means 100 during the deploy.

### Decision path

Start with rolling update. After the first production incident caused by a deploy, start introducing canary. Add Argo Rollouts to the 1-2 most critical services first, with canary steps plus AnalysisRun. The other services stay on rolling update.

Putting every service on canary costs tool maintenance (the Argo Rollouts + Istio + Prometheus integration), not just one YAML. Every service's AnalysisTemplate needs tuning: which metric, which threshold, how long an observation window. Tune it wrong and it is either too sensitive and keeps rolling back by mistake, or too loose and the same as nothing.

Blue-green's advantage is rollback speed. Canary's advantage is "there is no full rollback to do, because only 5% of users met the new version".

After canary is in place, if the AnalysisRun keeps passing (because the metric is too loose) and production still breaks, the problem is observability, not canary. Going back to add metrics works better than changing the deploy strategy.

---

## The whole chain again

```
Rolling Update (built into k8s)
  → probe passes, swap; no metrics gate
  → problem: probe passing does not equal correct business logic

Canary (Argo Rollouts)
  → a little traffic first, more once metrics are normal
  → problem: needs Istio + Prometheus + threshold tuning

Blue-Green (Argo Rollouts)
  → two environments, instant switch
  → problem: double resources + DB migration is hard to handle
```

After CD pushes the new version onto the cluster, how traffic reaches the new version is controlled by progressive delivery.

---

## Feature flag, Flagger, and Git state that does not match

**Feature Flag.** Canary controls traffic at the infra layer. A feature flag controls features at the app layer. Both let something new reach only some users first. They combine: canary controls who meets the new binary, the feature flag controls which features inside the new binary are turned on.

**Flagger.** Another progressive delivery controller, competing with Argo Rollouts. Flagger installs its own Canary CRD, which points at the native Kubernetes Deployment and HPA (Horizontal Pod Autoscaler) through targetRef, so the Deployment itself is untouched. Argo Rollouts uses its own Rollout CRD and has more features; an existing Deployment is either rewritten as a Rollout or referenced through workloadRef.

**The Git state problem with GitOps plus progressive delivery.** While a canary is in progress, the image tag in Git is already the new version, but only 5% of cluster traffic is on it. ArgoCD reports Synced, yet the rollout is not finished. To debug this gap, you first have to know which part ArgoCD manages and which part Rollouts manages.
