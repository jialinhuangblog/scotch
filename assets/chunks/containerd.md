---
title: "containerd"
slug: containerd
brief: "高階 runtime。負責拉取 image、管理 snapshot，建立 container 交給 runc。"
article: four-interfaces-one-pod
date: 2026-04-12
updated: 2026-10-19
revisions: 3
---

# containerd

containerd 是目前最主流的高階 container runtime。K8s 的 kubelet 透過 CRI（Container Runtime Interface，kubelet 跟 runtime 之間的 gRPC 介面）呼叫它。它自己不建 container，建 container 的是 runc，它負責 runc 之前跟之後的所有事。

## 一個 Pod 從 kubelet 到 runc

kubelet 收到一個排給自己的 Pod，裡面一個 container 用 `nginx:1.27`。它對 containerd 的 CRI socket 依序送 RunPodSandbox、PullImage、CreateContainer、StartContainer，containerd 收到每一個各做一段：

```text
RunPodSandbox
  1. 建 Pod 的 network namespace，呼叫 CNI 拿到 Pod 的 IP，再起一個 pause container 持有這些 namespace；
     fork 一個 containerd-shim，同一個 Pod 的 container 之後都共用這一個 shim
PullImage（kubelet 先問過本機，沒有這個 image 才送）
  2. 問 registry 這個 tag 的 manifest，拿到 3 個 layer 的 hash
  3. 本機已經有 2 個 layer（別的 image 用過），只下載第 3 個
CreateContainer
  4. 把 3 個 layer 疊成一個 snapshot，當 container 的 rootfs
  5. 寫一份 config.json（namespace、cgroup、mount、entrypoint），跟 rootfs 放同一個目錄，這就是 OCI bundle
  6. shim 執行 runc create：network、IPC、UTS namespace 加入 pause 的那一份，mount、PID namespace 跟 cgroup 另外建，
     runc 退出，留下一個 runc init 停著，nginx 還沒開始跑
StartContainer
  7. shim 執行 runc start，runc init exec 成 nginx，entrypoint 到這一步才開始跑，runc 再退出一次
  8. shim 留著，container 的 stdout、退出碼都由它回報給 containerd
```

layer 用內容的 hash 當名字，所以第 3 步能跳過下載，十個 Pod 用同一個 base image，磁碟上只有一份。CreateContainer 收到的時候 image 必須已經在本機，containerd 在這一步只查本機，查不到就報錯，不會自己去 registry 下載。runc 每次做完就退出，之後是 shim 替 containerd 看著 container，所以 containerd 自己升級重啟，正在跑的 container 不會跟著死。

## 歷史

containerd 原本是 Docker 內部的一個元件。Docker 原本是一整包 monolith，拆分的時候把 containerd 獨立出來。2017 年捐給 CNCF，2019 年畢業成獨立專案。現在 Docker 用它，K8s 也用它，但它不屬於任何一方。

## namespace 隔離

containerd 用自己的 namespace（不是 K8s namespace）隔離不同客戶端：

- `k8s.io` — kubelet 的 container
- `moby` — Docker 的 container

同一台機器上 Docker 跟 kubelet 接的是同一個 containerd，`docker ps` 列的是 `moby` 這個 namespace，看不到 K8s 的 pod；`crictl ps` 列的是 `k8s.io`，看不到 Docker 的 container。
