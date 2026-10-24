---
title: "CSI"
slug: csi
brief: "Container Storage Interface. The kubelet has no EBS or Ceph code in it; it only calls CSI, and each vendor's driver operates the actual storage."
article: four-interfaces-one-pod
date: 2026-04-12
updated: 2026-10-18
revisions: 2
---

# CSI (Container Storage Interface)

The kubelet needs to mount a volume, but it does not know where the volume is, how to create it, or how to format it. CSI is the standard interface between the kubelet and storage. The actual work is done by a driver that each vendor writes.

## Three stages

A Postgres StatefulSet wants a 20Gi disk. The manifest declares a PVC (PersistentVolumeClaim) whose storageClass points at `ebs-sc`, which has `volumeBindingMode: WaitForFirstConsumer`. From the PVC being created to Postgres seeing `/var/lib/postgresql/data`, three stages happen:

```
Provision → Attach → Mount
create disk  attach to Node  mount into container
```

**Provision**: once the PVC exists, it waits. `WaitForFirstConsumer` means the disk is only created after a Pod that uses this PVC is placed on a node, because an EBS volume can only attach to an EC2 instance in the same AZ. The Scheduler places the Postgres Pod on node-3, which is in us-east-1a. The CSI controller (a Pod running in the cluster) sees that this PVC now has a node, calls the AWS API to create a 20Gi EBS volume in us-east-1a, gets back `vol-0a1b`, and writes a PV bound to the PVC. The disk now exists, but is not attached to any machine yet.

**Attach**: the CSI controller calls the AWS API again to attach `vol-0a1b` to the EC2 instance that is node-3. A new `/dev/nvme1n1` appears on node-3.

**Mount**: the CSI node plugin on node-3 (a DaemonSet, one per node) finds the device empty, formats it as ext4, and mounts it at the directory the kubelet asked for. The kubelet then bind mounts that directory into the container at `/var/lib/postgresql/data`. A freshly formatted ext4 root already holds a `lost+found` that mkfs created, and if initdb uses this directory itself as the data directory, it stops with an error: `It contains a lost+found directory, perhaps due to it being a mount point.` So the manifest sets `PGDATA` to `/var/lib/postgresql/data/pgdata`. initdb creates that subdirectory under the mount point, and `lost+found` stays one level up.

The first two steps talk to the cloud API, so the controller does them. The third is a local filesystem operation that can only happen on that node, which is why it is split into a node plugin. The kubelet talks to the node plugin over gRPC over a Unix socket, and at no point does the kubelet contain a line of EBS code.

## Why it was pulled out

Before CSI, every storage backend was an in-tree driver compiled into the K8s source. Adding a new one meant a PR to `kubernetes/kubernetes`, and it could only ship with the K8s release cycle. CSI turns the driver into a separate Pod: anyone can write one, and it can ship at any time.

## Common implementations

| Driver | Backend |
|---|---|
| aws-ebs-csi-driver | AWS EBS |
| aws-efs-csi-driver | AWS EFS |
| gcp-pd-csi-driver | GCP Persistent Disk |
| csi-driver-nfs | NFS |
| longhorn | Distributed block storage (Rancher) |
