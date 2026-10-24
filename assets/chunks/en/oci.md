---
title: "OCI"
slug: oci
brief: "Open Container Initiative. How an image is packed, how it is downloaded from a registry, and how a container is built: three specs that unified every runtime."
article: four-interfaces-one-pod
date: 2026-04-12
updated: 2026-10-18
revisions: 2
---

# OCI (Open Container Initiative)

OCI is three specifications (specs) that define how an image is packaged, how a client downloads an image from a registry, and how a container is built. It is not a tool itself, and not a runtime you can run.

## Image Spec

Defines how a container image is packaged. An image is one manifest plus some layers, and each layer is a tar file named by the sha256 of its content. Suppose the manifest of `nginx:1.27` lists three layers: the first is the debian filesystem, the second is the result of apt install nginx, the third is the config files. If `python:3.12` is built on the same debian version, its first layer has the identical hash, and both the registry and the local machine store it once.

Docker invented this format and donated it to OCI. Docker manifest v2 and the OCI manifest differ slightly, but registries and runtimes accept both, so users never have to tell them apart.

## Distribution Spec

How `docker pull` and `crictl pull` ask the registry for these files is not covered by the Image Spec. It belongs to the third one, the Distribution Spec. The client first gets the manifest with `GET /v2/<name>/manifests/<tag>`, then downloads each layer by the sha256 listed in the manifest with `GET /v2/<name>/blobs/<digest>`. Both tools download the same manifest through the same API, so they fetch the same bytes.

## Runtime Spec

Defines how a container is built. The input is one directory, called a bundle, holding two things. `config.json` says which namespaces this container needs, how much CPU and memory the cgroup allows, which directories to mount, and what the entrypoint is. `rootfs` is the filesystem made by unpacking and stacking the three layers above.

runc reads `config.json`, creates the namespaces, sets up the cgroup, swaps the root directory to `rootfs` with `pivot_root`, execs into the entrypoint process, and then exits itself. gVisor and kata read the same `config.json`; the only difference is that they put the process inside their own sandbox instead of handing it straight to the host kernel.

## Why it matters

Without OCI, every runtime would define its own image format and container spec: containerd could not run CRI-O's images, Docker could not run kata's bundles. With OCI, the bundle above starts under runc, gVisor or kata alike, and switching runtimes does not mean repackaging the image.
