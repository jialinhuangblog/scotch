---
title: "OCI"
slug: oci
brief: "Open Container Initiative。Image 怎麼包、怎麼從 registry 下載、container 怎麼建，三份 spec 統一了所有 runtime。"
article: four-interfaces-one-pod
date: 2026-04-12
updated: 2026-10-18
revisions: 2
---

# OCI (Open Container Initiative)

OCI 是三份規格書（spec），定義 image 怎麼打包、client 怎麼從 registry 下載 image、container 怎麼建起來。它本身不是工具，也不是能跑的 runtime。

## Image Spec

定義 container image 怎麼包裝。一個 image 是一份 manifest 加幾個 layer，每個 layer 是一個 tar 檔，用內容的 sha256 當名字。假設 `nginx:1.27` 的 manifest 列三個 layer，第一個是 debian 的檔案系統，第二個是 apt install nginx 的結果，第三個是設定檔。`python:3.12` 要是也從同一版 debian 蓋起來，它的第一個 layer hash 一模一樣，registry 跟本機都只存一份。

Docker 發明了這個格式，捐給 OCI。Docker manifest v2 和 OCI manifest 有些微差異，但 registry 和 runtime 兩種都認得，使用者不用分辨。

## Distribution Spec

`docker pull` 和 `crictl pull` 怎麼跟 registry 要這些檔案，不歸 Image Spec 管，歸第三份 Distribution Spec。它規定 client 先用 `GET /v2/<name>/manifests/<tag>` 取得 manifest，再照 manifest 上列的 sha256 一個一個 `GET /v2/<name>/blobs/<digest>` 下載 layer。兩個工具照同一套 API 下載同一份 manifest，拿到的是同樣的 bytes。

## Runtime Spec

定義 container 怎麼建。輸入是一個目錄，叫 bundle，裡面兩樣東西。`config.json` 寫這個 container 要哪些 namespace、cgroup 限制多少 CPU 和記憶體、mount 哪些目錄、entrypoint 是什麼。`rootfs` 是上面三個 layer 解壓後疊好的檔案系統。

runc 讀 `config.json`，建立 namespace，設定 cgroup，用 `pivot_root` 把根目錄換成 `rootfs`，exec 成 entrypoint 的 process，然後自己退出。gVisor、kata 讀的是同一份 `config.json`，差別只在它們把 process 放進自己的 sandbox，而不是直接交給 host kernel。

## 為什麼重要

沒有 OCI 的話，每個 runtime 會各自定義 image format 和 container 規格，containerd 不能跑 CRI-O 的 image，Docker 不能跑 kata 的 bundle。有了 OCI，上面那個 bundle 交給 runc、gVisor、kata 哪一個都能起來，換 runtime 不用重打包 image。
