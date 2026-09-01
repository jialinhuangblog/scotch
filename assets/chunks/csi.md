---
title: "CSI"
slug: csi
brief: "Container Storage Interface。kubelet 不懂 EBS 也不懂 Ceph，它只呼叫 CSI，driver 自己去跟雲講。"
article: four-interfaces-one-pod
date: 2026-04-12
---

# CSI (Container Storage Interface)

kubelet 需要掛 volume，但它不知道 volume 在哪、怎麼建、怎麼格式化。CSI 是它和 storage 之間的標準接口。

## 三個階段

```
Provision → Attach → Mount
建磁碟      掛到 Node   mount 進 container
```

Provision 和 Attach 由 CSI Controller 負責（跟雲端 API 溝通），Mount 由 CSI Node plugin 負責（本地 filesystem 操作）。兩者透過 gRPC over Unix socket 通訊。

## 為什麼抽出來

CSI 之前，每個 storage backend 都是編譯進 K8s 原始碼的 in-tree driver。加新的要提 PR 給 `kubernetes/kubernetes`，跟 K8s release cycle 綁死。CSI 把 driver 變成獨立的 Pod，誰都能寫，隨時能發佈。

## 常見實作

| Driver | 後端 |
|---|---|
| aws-ebs-csi-driver | AWS EBS |
| aws-efs-csi-driver | AWS EFS |
| gcp-pd-csi-driver | GCP Persistent Disk |
| csi-driver-nfs | NFS |
| longhorn | 分散式 block storage（Rancher） |
