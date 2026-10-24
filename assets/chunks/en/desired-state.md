---
title: "Desired State"
slug: desired-state
brief: "Declare what you want and let the controller converge on it. k8s, Terraform, and ArgoCD all use this pattern."
date: 2026-03-14
updated: 2026-10-18
revisions: 2
article: before-k8s
---

# Desired State

Describe only the result you want. How to get there is the system's decision.

## Imperative vs declarative

Imperative: "Create a container on node A, set port 8080, connect it to the load balancer." This describes steps. When a step fails, you fix the step.

Declarative: "I want 3 replicas, port 8080, with a load balancer." This describes the result. The system works out how to get there.

k8s is declarative. The Deployment YAML says `replicas: 3`, and the controller counts the running Pods every little while. All three present, it does nothing. At night a node dies, and the Pod on it does not disappear right away: after the node is marked unreachable, by default k8s keeps the Pod bound to it for five more minutes (`tolerationSeconds=300`). When the five minutes are up, the Pod is evicted, the controller counts 2, one short of 3, so it creates one more and schedules it on another node. Nobody ever wrote an instruction saying "rebuild the Pod when a node dies"; the controller is only making up the difference. This count, compare, fix cycle is called the reconciliation loop.

Someone runs `kubectl scale` to 5 by hand. That changes the desired state itself: the Deployment now wants 5. The controller compares the 3 that exist against 5 and creates two more. It does not change it back to 3. Changing 5 back to 3 needs another desired state kept outside the cluster, such as the `replicas: 3` written in Git under [GitOps](chunk://gitops), with a tool like ArgoCD comparing the cluster against Git.

## k8s, Terraform, and ArgoCD are all declarative

- **k8s**: Deployment YAML = desired state, the controller reconciles
- **Terraform**: `.tf` files = desired state, `terraform apply` computes the diff and executes it
- **ArgoCD**: Git repo = desired state, the agent syncs it to the cluster

Applying the same desired state once or ten times gives the same result. Apply `replicas: 3` again, the controller counts 3, the difference is 0, and not a single Pod moves. This property is called [idempotency](chunk://idempotency) (idempotent). So when the state is broken, you do not debug how to repair it step by step. Apply the desired state again and the system converges back on its own.
