---
title: "runc"
slug: runc
brief: "低階 runtime。讀 OCI config.json，建 namespace + cgroup，exec process，然後退出。一次性工具。"
article: four-interfaces-one-pod
date: 2026-04-12
updated: 2026-10-18
revisions: 2
---

# runc

runc 是 OCI（Open Container Initiative）的預設低階 runtime，只負責把 OCI bundle（一個目錄，裡面是 rootfs 加上 config.json）變成一個跑起來的 container。

## 動作

拿一個 nginx container 走一遍。bundle 目錄裡 `rootfs/` 是解開的 nginx image，`config.json` 寫著要跑 `nginx -g 'daemon off;'`、memory 上限 256MB、要哪幾種 namespace。

containerd 要起這個 container 的時候，是由 shim 先執行 `runc create web1`，再執行 `runc start web1`，runc 依序做：

1. 讀 `config.json`
2. 建立 Linux namespace（pid、net、mnt、ipc、uts）。從這一刻起，新 process 看到的 PID 從 1 開始，看不到 host 的其他 process
3. 設定 cgroup，把這個 process 放進一個 memory 上限 256MB 的群組
4. `pivot_root`，把根目錄換成 `rootfs`，所以它看到的 `/etc/nginx` 是 image 裡的那份
5. `runc create` 做到這裡就退出，留下一個叫 `runc init` 的 process 停著等，nginx 還沒開始跑
6. `runc start` 通知 `runc init` 去 `exec` nginx，這個 process 從此變成 nginx，`runc start` 自己也退出

跑完之後，host 上 `ps` 看到 nginx 的 master 跟它底下的 worker，master 的 PID 例如 48213，parent 是 `containerd-shim-runc-v2`，列表裡沒有任何 runc process。container 裡面看到同一個 master，PID 是 1。

在 shell 手動下 `runc run web1` 就不一樣了。`runc run` 一個指令做完 create 跟 start，但不加 `--detach` 的話 runc 不會退出，它一直留著當 nginx 的 parent，等 nginx 結束，再用 nginx 的退出碼結束自己。實際跑過一次，`ps` 裡 `runc run web1` 的 PID 是 23，nginx master 的 parent 就是 23。

在 containerd 這條路上，runc 每個指令做完就退出。那誰來當 container 的 parent 呢？是 `containerd-shim-runc-v2`，它留下來呼叫 `waitpid()` 收集 exit code，再回報給 containerd。nginx 掛掉的時候，是 shim 收到 exit code 1，containerd 才知道要回報 kubelet。

## 替代方案

| Runtime | 差異 |
|---|---|
| **gVisor (runsc)** | 用 user-space kernel 攔截 syscall，多一層隔離 |
| **kata-runtime** | 每個 container 跑在輕量 VM 裡，完全隔離 kernel |

三者都是 OCI-compatible。k8s 用 RuntimeClass 指定要哪一種，containerd 再依設定呼叫對應的 runtime。
