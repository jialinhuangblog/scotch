---
title: "containerd"
slug: containerd
brief: "High-level runtime. Pulls images, manages snapshots, creates the container and hands it to runc."
article: four-interfaces-one-pod
date: 2026-04-12
updated: 2026-10-19
revisions: 3
---

# containerd

containerd is the most widely used high-level container runtime today. The K8s kubelet calls it through CRI (Container Runtime Interface, the gRPC interface between the kubelet and the runtime). It does not create the container itself; runc does that. containerd handles everything before and after runc.

## One Pod from kubelet to runc

The kubelet receives a Pod assigned to it, with one container running `nginx:1.27`. It sends RunPodSandbox, PullImage, CreateContainer and StartContainer to containerd's CRI socket in that order, and containerd does one part of the work for each:

```text
RunPodSandbox
  1. Create the Pod's network namespace, call CNI to get the Pod's IP, and start a pause container that holds these namespaces;
     fork a containerd-shim; every container of this Pod later shares this one shim
PullImage (the kubelet checks the local images first and sends this only if the image is missing)
  2. Ask the registry for this tag's manifest, get the hashes of 3 layers
  3. 2 layers are already on this machine (used by another image), download only the 3rd
CreateContainer
  4. Stack the 3 layers into one snapshot, the container's rootfs
  5. Write a config.json (namespaces, cgroup, mounts, entrypoint) next to the rootfs; that directory is the OCI bundle
  6. The shim runs runc create: the container joins the pause container's network, IPC and UTS namespaces and gets its own mount and PID namespaces and cgroup;
     runc exits, and a runc init process is left waiting; nginx has not started yet
StartContainer
  7. The shim runs runc start: runc init execs into nginx, the entrypoint only starts running now, and runc exits again
  8. The shim stays, and reports the container's stdout and exit code back to containerd
```

Layers are named by the hash of their content, which is why step 3 can skip the download: ten Pods on the same base image share one copy on disk. When CreateContainer arrives, the image must already be on the machine: at this step containerd only looks it up locally and returns an error if it is missing, without downloading anything from the registry. runc exits after each command, and from then on the shim watches the container for containerd. So when containerd itself is upgraded and restarted, the running containers do not die with it.

## History

containerd started as an internal component of Docker. Docker was one big monolith; when it was split up, containerd was carved out on its own. It was donated to the CNCF in 2017 and graduated as an independent project in 2019. Today Docker uses it and K8s uses it, but it belongs to neither.

## namespace isolation

containerd uses its own namespaces (not K8s namespaces) to separate different clients:

- `k8s.io` — containers from the kubelet
- `moby` — containers from Docker

On one machine Docker and the kubelet talk to the same containerd. `docker ps` lists the `moby` namespace and cannot see K8s pods; `crictl ps` lists `k8s.io` and cannot see Docker containers.
