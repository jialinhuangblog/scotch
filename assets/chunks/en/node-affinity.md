---
title: "Affinity"
slug: node-affinity
brief: "A pod states its own preferences: required goes through filter, preferred goes through score; anti-affinity spreads pods of the same service apart."
date: 2026-07-20
updated: 2026-07-20
revisions: 1
---

# Affinity

When the [Scheduler](chunk://scheduler) places a Pod, affinity is how the Pod states its own preferences: "where I want to go" or "who I do not want to be with".

**nodeAffinity** — the Pod's preference about nodes, more flexible than nodeSelector:

```yaml
spec:
  affinity:
    nodeAffinity:
      # hard: must be satisfied (same as filter)
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: zone
                operator: In
                values: ["us-east-1a", "us-east-1b"]
      # soft: satisfy if possible (affects score)
      preferredDuringSchedulingIgnoredDuringExecution:
        - weight: 80
          preference:
            matchExpressions:
              - key: disk
                operator: In
                values: ["ssd"]
```

`required` is the filter layer: a node that does not match is dropped outright. `preferred` is the score layer: a match earns points but is not enforced.

**podAntiAffinity** — spread the Pods of one service across different zones:

```yaml
spec:
  affinity:
    podAntiAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        - labelSelector:
            matchLabels:
              app: api
          topologyKey: topology.kubernetes.io/zone
```

Why this rule means "if zone-a already has an `app: api` Pod, no more go into zone-a":

- `labelSelector` picks out "who": Pods carrying `app: api`.
- `topologyKey` decides "how big one cell is": every node carries the label `topology.kubernetes.io/zone` (the cloud provider sets it automatically), and nodes with the same value belong to the same zone.
- The required rule of anti-affinity: do not schedule me into a cell that already holds a selected Pod.

When the Scheduler checks each candidate node, it first reads the node's zone label value, then looks at whether any node in that whole zone is running an `app: api` Pod. If one is, this node is filtered out. So as soon as zone-a has one `app: api`, **every** node in zone-a fails the filter, and the next Pod can only go to zone-b or zone-c.

Change `topologyKey` to `kubernetes.io/hostname` and "one cell" shrinks from a zone to a single node; the rule becomes "do not put two on the same node".
