---
title: "Taint & Toleration"
slug: taint-toleration
brief: "The node marks itself as unwelcoming; a pod without a matching toleration is dropped in the filter stage."
date: 2026-07-20
updated: 2026-07-20
revisions: 1
---

# Taint + Toleration

One of the checks in the [scheduler](chunk://scheduler) filter stage, in the opposite direction from nodeSelector: the Pod does not pick the node, the node marks itself "not welcome". A Pod without a matching toleration is dropped in the filter stage.

Scenario: one GPU node, and you do not want ordinary workloads taking its resources.

```yaml
# set the taint on the node (an admin operation)
# kubectl taint nodes gpu-node-1 gpu=true:NoSchedule

# A Pod that should run on the GPU node must add a toleration
spec:
  tolerations:
    - key: "gpu"
      operator: "Equal"
      value: "true"
      effect: "NoSchedule"
```

A Pod without the toleration → dropped by the filter. With it → allowed to be scheduled there.

A toleration has to match both key / value and effect:

- **key / value**: `operator: Equal` requires both key and value to be equal; `operator: Exists` only checks whether the key exists and ignores the value.
- **effect**: a taint's effect states "what to do with Pods that do not tolerate it". `NoSchedule` does not schedule them in, `PreferNoSchedule` tries not to (soft), and `NoExecute` is the strictest: even Pods already running on the node are evicted. A toleration that names an effect tolerates only that one; leaving the effect field out entirely tolerates every effect of that key.

So the example above reads: "I tolerate the `NoSchedule` of the taint `gpu=true`". If someone later adds `gpu=true:NoExecute` to the node, this Pod is evicted all the same, because it only tolerated NoSchedule.

A toleration only allows, it does not assign, so a Pod with a toleration may still be scheduled onto another node. To make it always go to the GPU node, add [affinity](chunk://node-affinity) as well.
