---
title: "Scheduler"
slug: scheduler
brief: "Decides which node a pod runs on. Filter removes the nodes that do not qualify, then score picks the best of the rest."
date: 2026-04-08
updated: 2026-07-20
revisions: 2
---

# Scheduler

A Pod has been created, but it has no node yet. The Scheduler picks the most suitable one out of all nodes.

## Filter: remove the nodes that do not qualify

Filter asks "can this node run it at all". Fail any one check and the node is out.

Say a Pod requests 2 CPU and 4Gi of memory, and is restricted to nodes with the `disk=ssd` label:

```yaml
spec:
  containers:
    - name: api
      resources:
        requests:
          cpu: "2"
          memory: "4Gi"
  nodeSelector:
    disk: ssd
```

```text
node-1: 1 CPU left        → not enough resources, out
node-2: no disk=ssd       → label does not match, out
node-3: 4 CPU + disk=ssd  → passes
node-4: 8 CPU + disk=ssd  → passes
```

Other filter conditions include [a taint with no matching toleration](chunk://taint-toleration) and [an affinity rule that is not satisfied](chunk://node-affinity). Both have their own chunk.

## Score: pick the best among the nodes that passed

After filtering, several nodes may remain. In the score phase, several extensions (scheduler plugins) each give a score, the scores are summed, and the node with the highest total is chosen.

The main extensions:

| Extension | What it scores | Logic |
|---|---|---|
| LeastAllocated | CPU/memory left over | `((capacity - requested) / capacity) * 100`, more left means a higher score |
| ImageLocality | Whether the image is already pulled | Image already on the node → saves download time, extra points |

The Scheduler does not look at actual CPU usage. It only sums the `resources.requests` of every Pod already scheduled there.

Say two nodes each have 8 CPU and 16Gi of memory. The formula is `((capacity - requested) / capacity) × 100`, computed once for CPU and once for memory, then averaged:

1. The Pods on **node-3** already request 6 CPU and 12Gi. CPU left `(8-6)/8 × 100 = 25`, memory `(16-12)/16 × 100 = 25`, average LeastAllocated = 25.
2. The Pods on **node-4** request only 2 CPU and 4Gi. CPU `(8-2)/8 × 100 = 75`, memory `(16-4)/16 × 100 = 75`, average = 75. More left means a higher score, so node-4 leads for now.
3. Add ImageLocality: node-3 has not pulled this image yet, gets 0, stays at 25; node-4 already has it, gets 15, rising to 90.
4. Compare the two, and the pod is scheduled to node-4.

## Binding: the scheduler only fills in nodeName and does not start the Pod

The Pod object was stored in etcd at `kubectl apply` time, but its `nodeName` was empty. After choosing, the Scheduler updates that field:

```yaml
# before scheduling (Pod already in etcd, nodeName empty)
spec:
  nodeName: ""

# after scheduling (Scheduler updated nodeName)
spec:
  nodeName: "node-4"
```

The [kubelet](chunk://data-plane) on that node watches `nodeName` become its own name, and only then pulls the image and starts the container. The Scheduler only writes down the decision. The actual start is not its job.
