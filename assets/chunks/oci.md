---
title: "OCI"
slug: oci
brief: "Open Container Initiative。Image 怎麼包、container 怎麼建，兩份 spec 統一了所有 runtime。"
article: four-interfaces-one-pod
date: 2026-04-12
---

# OCI (Open Container Initiative)

OCI 是兩份規格書（spec），定義「image 怎麼打包」和「container 怎麼建起來」這兩件事的實作介面。它本身不是工具，也不是能跑的 runtime。

## Image Spec

定義 container image 怎麼包裝。Layer 是 tar + content-addressable hash。`docker pull` 和 `crictl pull` 拿到同一堆 bytes。

Docker 發明了這個格式，捐給 OCI。Docker manifest v2 和 OCI manifest 有些微差異，但 registry 和 runtime 都能透明處理。

## Runtime Spec

定義 container 怎麼建。一個目錄：`config.json`（namespace、cgroup、mount、entrypoint）+ `rootfs`（解壓後的 image layers）。

runc 讀 `config.json`，建 namespace，設 cgroup，`pivot_root` 進 `rootfs`，exec process，然後退出。任何 OCI-compatible runtime（runc、gVisor、kata）都能讀這份 spec。

## 為什麼重要

沒有 OCI，每個 runtime 發明自己的 image format 和 container 規格。containerd 不能跑 CRI-O 的 image，Docker 不能跑 kata 的 bundle。OCI 是一份大家都照著做的標準。
