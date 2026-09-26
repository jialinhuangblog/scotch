---
title: "OCI"
slug: oci
brief: "Open Container Initiative。Image 怎麼包、container 怎麼建，兩份 spec 統一了所有 runtime。"
article: four-interfaces-one-pod
date: 2026-04-12
---

# OCI (Open Container Initiative)

OCI 是兩份規格書（spec），定義 image 怎麼打包、container 怎麼建起來。它本身不是工具，也不是能跑的 runtime。

## Image Spec

定義 container image 怎麼包裝。每個 layer 是一個 tar 檔，用內容的 hash 當名字（content-addressable），內容一樣就是同一個 layer。`docker pull` 和 `crictl pull` 取得的是同樣的 bytes。

Docker 發明了這個格式，捐給 OCI。Docker manifest v2 和 OCI manifest 有些微差異，但 registry 和 runtime 兩種都認得，使用者不用分辨。

## Runtime Spec

定義 container 怎麼建。一個目錄：`config.json`（namespace、cgroup、mount、entrypoint）+ `rootfs`（解壓後的 image layers）。

runc 依序讀取 `config.json`、建立 namespace、設定 cgroup，再用 `pivot_root` 把根目錄換成 `rootfs`，最後 exec process，然後自己退出。任何 OCI-compatible runtime（runc、gVisor、kata）都能讀這份 spec。

## 為什麼重要

沒有 OCI 的話，每個 runtime 會各自定義 image format 和 container 規格。containerd 不能跑 CRI-O 的 image，Docker 不能跑 kata 的 bundle。
