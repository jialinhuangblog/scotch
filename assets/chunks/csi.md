---
title: "CSI"
slug: csi
brief: "Container Storage Interface。kubelet 裡沒有 EBS 或 Ceph 的程式碼，它只呼叫 CSI，由各家 driver 去操作實際的 storage。"
article: four-interfaces-one-pod
date: 2026-04-12
updated: 2026-10-18
revisions: 2
---

# CSI (Container Storage Interface)

kubelet 需要掛 volume，但它不知道 volume 在哪、怎麼建、怎麼格式化。CSI 是 kubelet 和 storage 之間的標準 interface，實際動手的是各家自己寫的 driver。

## 三個階段

一個 Postgres 的 StatefulSet 要一顆 20Gi 的磁碟。manifest 裡寫的是 PVC（PersistentVolumeClaim），storageClass 指到 `ebs-sc`，它的 `volumeBindingMode` 是 `WaitForFirstConsumer`。從 PVC 建立到 Postgres 看到 `/var/lib/postgresql/data`，經過三個階段：

```
Provision → Attach → Mount
建磁碟      掛到 Node   mount 進 container
```

**Provision**：PVC 建好之後先等著。`WaitForFirstConsumer` 的意思是等用這張 PVC 的 Pod 排到 node 才建磁碟，因為 EBS 只能掛給同一個 AZ 的 EC2。Scheduler 把 Postgres 的 Pod 排到 node-3，node-3 在 us-east-1a。CSI controller（一個跑在 cluster 裡的 Pod）看到這張 PVC 有了 node，呼叫 AWS API 在 us-east-1a 建一顆 20Gi 的 EBS volume，拿到 `vol-0a1b`，寫一個 PV 綁到 PVC 上。這時磁碟存在，但還沒掛到任何機器。

**Attach**：CSI controller 再呼叫一次 AWS API，把 `vol-0a1b` 掛到 node-3 這台 EC2 上。node-3 上多出一個 `/dev/nvme1n1`。

**Mount**：node-3 上的 CSI node plugin（DaemonSet，每台 node 一個）發現這顆裝置是空的，格式化成 ext4，mount 到 kubelet 指定的目錄，kubelet 再把那個目錄 bind mount 進 container 的 `/var/lib/postgresql/data`。剛格式化的 ext4 根目錄裡已經有一個 mkfs 建的 `lost+found`，initdb 要是直接拿這個目錄當資料目錄，會報錯停下：`It contains a lost+found directory, perhaps due to it being a mount point.` 所以 manifest 裡把 `PGDATA` 設成 `/var/lib/postgresql/data/pgdata`，initdb 在 mount point 底下自己開一個子目錄，`lost+found` 留在上一層。

前兩步是跟雲端 API 講話，由 controller 做。第三步是本機的 filesystem 操作，只有在那台 node 上才能做，所以拆成 node plugin。kubelet 跟 node plugin 之間走 gRPC over Unix socket，kubelet 從頭到尾沒有一行 EBS 的程式碼。

## 為什麼抽出來

CSI 之前，每個 storage backend 都是編譯進 K8s 原始碼的 in-tree driver。加新的要提 PR 給 `kubernetes/kubernetes`，只能跟著 K8s 的 release cycle 發佈。CSI 把 driver 變成獨立的 Pod，誰都能寫，隨時能發佈。

## 常見實作

| Driver | 後端 |
|---|---|
| aws-ebs-csi-driver | AWS EBS |
| aws-efs-csi-driver | AWS EFS |
| gcp-pd-csi-driver | GCP Persistent Disk |
| csi-driver-nfs | NFS |
| longhorn | 分散式 block storage（Rancher） |
