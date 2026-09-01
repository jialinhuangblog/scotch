---
title: "runc"
slug: runc
brief: "低階 runtime。讀 OCI config.json，建 namespace + cgroup，exec process，然後退出。一次性工具。"
article: four-interfaces-one-pod
date: 2026-04-12
---

# runc

runc 是 OCI 的預設低階 runtime。它做一件事：把 OCI bundle 變成一個跑起來的 container。

## 動作

1. 讀 `config.json`
2. 建立 Linux namespace（pid、net、mnt、ipc、uts）
3. 設定 cgroup（CPU、memory 限制）
4. `pivot_root` 進 `rootfs`
5. `exec` container process
6. 退出

runc 是一次性工具。container 跑起來後 runc 就不在了。誰來當 container 的 parent？是 `containerd-shim-runc-v2`，它留下來呼叫 `waitpid()`，收集 exit code，回報給 containerd。

## 替代方案

| Runtime | 差異 |
|---|---|
| **gVisor (runsc)** | 用 user-space kernel 攔截 syscall，多一層隔離 |
| **kata-runtime** | 每個 container 跑在輕量 VM 裡，完全隔離 kernel |

三者都是 OCI-compatible。containerd 透過 RuntimeClass 選要呼叫哪一個。
