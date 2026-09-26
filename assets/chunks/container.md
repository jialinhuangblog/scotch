---
title: "Container"
slug: container
brief: "用 namespace + cgroups 做 OS 層級的 process 隔離。把 app + 依賴打包成可攜 image。"
date: 2026-03-14
article: before-k8s
---

# Container

> 同一個 app 在筆電上跑得好好的，搬到 server 就一堆環境問題。怎麼讓它到哪都一樣？

Container 其實就是 host 上的一個普通 process，只是被限制了視野跟資源，讓它以為自己獨佔一整台機器。

## 兩個 Linux 機制

**Namespaces**

隔離視野。Container 裡的 process 看到的 PID 從 1 開始、看不到 host 的檔案系統、有自己的網路 stack。不是虛擬機，跑的還是 host 的 kernel，只是看不到其他 process。

**Cgroups**

限制資源。CPU 最多用 0.5 核、記憶體最多 256MB。超過就被 OOM kill。

## Image：把 app 跟環境一起打包

Dockerfile 定義 image：OS base layer + app code + dependencies。`docker build` 產出 image，`docker run` 跑 container。

好處是同一個 image 在筆電上能跑，搬到 production server 也照樣能跑，不會再發生「在我機器上明明好好的」那種事。

## Container 不處理跨機器調度

一台機器上跑 container 很單純。但十台、上百台呢？哪個 container 該放哪台機器、掛了誰負責重啟、流量怎麼分給它們，container 本身沒有處理這些的機制。

統一調度這些 container 的是 k8s。
