---
title: "Pause Container"
slug: pause-container
brief: "A process that does nothing. It only holds the Pod's namespaces, so when the app restarts the IP stays the same."
article: four-interfaces-one-pod
date: 2026-04-12
---

# Pause Container

Every Pod has a container you normally never see, called the pause container. It runs a single syscall: `pause()` (sleep forever).

## Why

A Linux namespace is attached to a process. When no process holds the network namespace, the namespace disappears and the IP goes with it.

The pause container is the process that "stays alive forever". The other containers in the Pod (nginx, sidecar) join its namespaces:

```
pause (holds netns, ipc ns, uts ns)
├── nginx (joins pause's namespaces)
└── sidecar (joins pause's namespaces)
```

nginx crashes → kubelet restarts nginx → the new nginx joins the same pause's namespaces → the IP is unchanged.

If nginx were the namespace holder, the namespace would disappear the moment nginx crashed, and the IP with it.

## Sandbox vs Pause Container

The CRI only says `RunPodSandbox()`, meaning "build a shared environment for this Pod", without saying how that environment is built.

containerd's implementation: create a pause container to hold those namespaces.

Sandbox is the term in the CRI spec; pause container is containerd's implementation.
