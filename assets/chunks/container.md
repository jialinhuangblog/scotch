---
title: "Container"
slug: container
brief: "用 namespace + cgroups 做 OS 層級的 process 隔離。把 app + 依賴打包成可攜 image。"
date: 2026-03-14
updated: 2026-10-18
revisions: 3
article: before-k8s
---

# Container

> 同一個 app 在筆電上跑得好好的，搬到 server 就一堆環境問題。怎麼讓它到哪都一樣？

Container 其實就是 host 上的一個普通 process，只是被限制了視野跟資源，讓它以為自己獨佔一整台機器。

## 兩個 Linux 機制

**Namespaces**

隔離視野。在 host 上 `docker run nginx`，在一台 5 核的機器上，host 的 `ps` 多出 6 個 nginx process，跟其他幾百個 process 排在一起：master 的 PID 是 5593，底下 5 個 worker 是 5644 到 5648。worker 有 5 個，是因為官方 image 的 nginx.conf 寫 `worker_processes auto`，一核一個。進到 container 裡面列 `/proc`（nginx image 沒裝 `ps`），列出來的是同樣這 6 個，master 是 PID 1，worker 是 29 到 33，另外只多一個執行列表的那個 shell 自己。同一批 process，兩邊的 PID 不一樣，因為它們在自己的 pid namespace 裡。container 裡列出來的每個 process，host 的 `ps` 裡都有；host 上其他幾百個 process，container 裡一個也沒有。檔案系統跟網路也一樣，它看到的 `/` 是 image 解開的目錄，看到的 eth0 是一張虛擬網卡，host 上真正的 `/etc` 跟其他 container 開的 port 都看不到。不是虛擬機，跑的還是 host 的 kernel，只是看不到其他 process。

**Cgroups**

限制資源。`docker run --memory 256m --cpus 0.5 nginx`，kernel 把這個 process 放進一個群組。記憶體用到 256MB 的時候，kernel 先在這個群組裡回收能丟的部分，例如讀檔留下的 page cache。拿一個 64MB 上限的 container 實際跑過，連讀 192MB 的檔案三次，用量貼著上限碰了 3,236 次，每次都靠回收解決，OOM 一次也沒發生。回收不了的才會出事：nginx 自己要的 heap 記憶體沒有東西可丟，沒有 swap 可用時一超過上限，kernel 就從這個群組裡挑一個 process 殺掉，可能是某個 worker，不一定是 PID 1。host 上其他 process 不受影響。CPU 每 100 毫秒最多跑 50 毫秒，忙的時候被排程器暫停，等下一個 100 毫秒。

## Image：把 app 跟環境一起打包

Dockerfile 定義 image：OS base layer + app code + dependencies。`docker build` 產出 image，`docker run` 跑 container。

同一個 image 在筆電上能跑，搬到 production server 也照樣能跑。筆電裝的是 Node 22、server 裝的是 Node 18 也沒關係，因為 container 裡用的 Node 是 image 裡那一份，不是 host 的。

## Container 不處理跨機器調度

一台機器上跑 container 很單純。但十台、上百台呢？哪個 container 該放哪台機器、掛了誰負責重啟、流量怎麼分給它們，container 本身沒有處理這些的機制。

統一調度這些 container 的是 k8s。
