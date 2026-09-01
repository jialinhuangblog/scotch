---
title: "containerd"
slug: containerd
brief: "高階 runtime。負責拉 image、管 snapshot，實際建 container 交給 runc。"
article: four-interfaces-one-pod
date: 2026-04-12
---

# containerd

containerd 是目前最主流的高階 container runtime。K8s 的 kubelet 透過 CRI 跟它講話。

## 它做什麼

1. 從 registry 拉 image（OCI Image Spec）
2. 管理 snapshot（image 的 filesystem layers）
3. 準備 OCI bundle（config.json + rootfs）
4. 呼叫 runc 建 container
5. 透過 containerd-shim 監控 container 生命週期

真正建 container 的是 runc，containerd 在上面管調度跟生命週期。

## 歷史

containerd 原本是 Docker 內部的一個元件。Docker 的 monolith 太肥，拆分時 containerd 獨立出來。2017 年捐給 CNCF，2019 年畢業成獨立專案。現在 Docker 用它，K8s 也用它，但它不屬於任何一方。

## namespace 隔離

containerd 用自己的 namespace（不是 K8s namespace）隔離不同客戶端：

- `k8s.io` — kubelet 的 container
- `moby` — Docker 的 container

`docker ps` 看不到 K8s pod，`crictl ps` 看不到 Docker container。跑在同一個 runtime 上，可是彼此看不到對方。
