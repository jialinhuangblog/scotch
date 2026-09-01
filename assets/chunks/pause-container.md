---
title: "Pause Container"
slug: pause-container
brief: "什麼都不做的 process，只負責持有 Pod 的 namespace，所以 app 重啟 IP 不會跟著變。"
article: four-interfaces-one-pod
date: 2026-04-12
---

# Pause Container

每個 Pod 裡都有一個你看不到的 container，叫 pause container。它只執行一個 syscall：`pause()`（永遠 sleep）。

## Why

Linux namespace 依附在 process 上。沒有 process 持有 network namespace，namespace 就消失，IP 就沒了。

pause container 是那個「永遠活著」的 process。Pod 裡的其他 container（nginx、sidecar）加入它的 namespace：

```
pause (holds netns, ipc ns, uts ns)
├── nginx (joins pause's namespaces)
└── sidecar (joins pause's namespaces)
```

nginx crash → kubelet restart nginx → 新的 nginx 加入同一個 pause 的 namespace → IP 沒變。

如果用 nginx 當 namespace holder，nginx crash 瞬間 namespace 消失，IP 也跟著沒了。

## Sandbox vs Pause Container

CRI 只說 `RunPodSandbox()`，意思是「幫這個 Pod 建一個共享環境」，但沒規定這環境怎麼生出來。

containerd 的實作是：建一個 pause container 來持有那些 namespace。

sandbox 是 CRI 規格上的講法，pause container 是實際做出來的東西。
