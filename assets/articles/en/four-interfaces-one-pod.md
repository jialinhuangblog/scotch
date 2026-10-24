---
title: "CSI → CRI → CNI → OCI: the four contracts behind one Pod"
slug: four-interfaces-one-pod
date: 2026-04-12
updated: 2026-10-17
revisions: 1
subtitle: "kubelet does not build the container, set up the network, or mount the volume. It makes four phone calls, each to a different contractor."
chapter: "extras"
tags: [k8s, cri, oci, cni, csi, containerd, runc]
related: [cni-network, k8s-planes, packet-journey]
---

# CSI → CRI → CNI → OCI: the four contracts behind one Pod

kubelet does not build the container, set up the network, mount the volume, or pull the image by itself. It outsources those four jobs. It makes four phone calls, each to a different contractor.

Every contractor takes the job through a standardized interface. The contract only says "whoever does it, get this done". So the implementations have been swapped several times, and the interfaces have not moved.

```
kubelet
  ├─ CSI  → "give me a volume"
  ├─ CRI  → "create a sandbox, run a container"
  │    ├─ CNI  → "connect this sandbox to the network"
  │    └─ OCI  → "here is the image spec, here is the runtime spec, go"
  └─ (kubelet itself does nothing)
```

[CSI](chunk://csi), [CRI](chunk://cri-cni), [CNI](chunk://cri-cni) and [OCI](chunk://oci) are those four interfaces.

---

## Why four interfaces

In 2014, kubelet's runtime, networking and storage were all written directly against Docker's API.

Then the alternatives arrived. rkt wanted to be the runtime, Flannel and Calico wanted to manage networking, Ceph and EBS wanted to provide storage. Every new implementation meant another change to kubelet's code.

So K8s pulled the interfaces out. kubelet speaks a standard protocol, and the implementations compete behind it.

| Interface | Extracted | Why |
|---|---|---|
| **CNI** | 2015 | CoreOS's rkt needed container networking. CNI is a CNCF spec, not tied to K8s. |
| **CRI** | 2016 | rkt wanted to plug into K8s as a runtime. Without an interface, a second runtime would have to be written straight into kubelet. |
| **CSI** | 2017 | Every cloud's storage driver was compiled into the K8s core. Adding a new one meant a PR to K8s itself. |
| **OCI** | 2015 | Docker donated the image format and the runtime spec to a neutral foundation. Otherwise every runtime would invent its own. |

The order in which a Pod build calls these four interfaces has nothing to do with the year each one appeared.

---

## Timeline: one Pod, four interfaces

```
$ kubectl run nginx --image=nginx

 t=0   API Server writes the Pod to [etcd](chunk://etcd) (status: Pending)
 t=1   Scheduler picks a Node (status: Pending, nodeName set)
 t=2   kubelet on that Node notices the new Pod
        │
        ├─ t=3  CSI: Provision + Attach + Mount volume
        │        (skipped when there is no PVC. nginx has no PVC, so it is skipped in practice; it is listed here to show the order)
        │
        ├─ t=4  CRI: RunPodSandbox()
        │        │
        │        └─ t=4.1  CNI: set up the pod network inside the sandbox
        │
        ├─ t=5  CRI: PullImage() ← OCI Image Spec
        │
        ├─ t=6  CRI: CreateContainer() ← OCI Runtime Spec (config.json)
        │
        ├─ t=7  CRI: StartContainer()
        │        containerd → shim → runc → container is running
        │
 t=8   kubelet updates the Pod status (status: Running)
```

CSI goes first. CNI happens inside CRI's `RunPodSandbox()`. OCI is used twice, once for the image format and once for the runtime config.

---

## CSI: "give me a volume"

Container Storage Interface, the interface between kubelet and the storage provider.

### What problem it solves

Before CSI, every storage backend (AWS EBS, GCE PD, Ceph, NFS, iSCSI) was a plugin compiled into the K8s source code, called an in-tree driver. To add a new one:

1. Write the driver in Go
2. Open a PR against `kubernetes/kubernetes`
3. Wait for the K8s maintainers to review it, even though they do not know this storage system
4. Ship it with the next K8s release
5. Every K8s cluster in the world carries this driver binary, even if nobody uses it

K8s once had more than 20 in-tree storage drivers. The K8s team had to maintain every one of them, and their release schedule was tied to the K8s release cycle.

CSI moved the drivers out of the K8s binary. A CSI driver runs on the cluster as Pods, and kubelet talks to it over a Unix socket. So anyone can write a driver, publish it on their own, and upgrade it independently.

### The stages a volume goes through

A volume passes through three stages before a container can use it:

```
Stage 1: Provision (create the actual disk)
  │  CSI Controller: CreateVolume()
  │  "AWS, create a 10Gi gp3 EBS volume for me in us-east-1a"
  │  → AWS returns vol-0abc123
  │
Stage 2: Attach (connect the disk to the Node)
  │  CSI Controller: ControllerPublishVolume()
  │  "AWS, attach vol-0abc123 to instance i-xyz789"
  │  → the EBS volume shows up on the Node as /dev/nvme1n1
  │
Stage 3: Mount (make it usable by the container)
     CSI Node: NodeStageVolume() + NodePublishVolume()
     "format /dev/nvme1n1 as ext4, mount it at /var/lib/kubelet/pods/<id>/volumes/"
     → the directory is ready. kubelet passes it to CRI as a bind mount.
```

Stages 1 and 2 run on the CSI Controller (usually a Deployment). Stage 3 runs on the CSI Node (a DaemonSet on every Node). The Controller calls the cloud API. The Node does local filesystem operations.

### What runs in a real cluster

In the k8s-snapshot from kubelens, kube-system has:

```
ebs-csi-controller-...   6/6   Running  ← Controller + 5 sidecars
ebs-csi-node-...         3/3   Running  ← one per Node
efs-csi-controller-...   3/3   Running  ← same architecture, for EFS (similar to NFS)
efs-csi-node-...         3/3   Running
```

Two CSI drivers: **EBS** (block storage) and **EFS** (shared storage). The 6/6 on the Controller means 1 CSI plugin plus 5 sidecars (provisioner, attacher, snapshotter, resizer, liveness-probe).

### Where CSI sits among the other interfaces

CSI runs **before CRI**. The volume has to be mounted on the Node before the container can start. If attaching the EBS volume takes 30 seconds, the Pod sits in `ContainerCreating` for 30 seconds. kubelet does not call `RunPodSandbox` until the volume is ready.

Exception: `emptyDir` and `hostPath` do not go through CSI. They are local directories, and kubelet handles them itself.

---

## CRI: "create a sandbox, run a container"

Container Runtime Interface, the interface between kubelet and the container runtime.

The full story is in [K8s needed Docker. Then it didn't.](https://jialin00.com/v2/container-runtime-evolution) and [inside containerd: how shim and runc actually work](https://jialin00.com/v2/containerd-shim-and-runc). This section focuses on CRI's role in the Pod creation timeline.

### Two gRPC services

CRI is one gRPC connection that provides two services:

**RuntimeService**, the Pod and container lifecycle:

```
RunPodSandbox()     → create the network namespace (triggers CNI)
CreateContainer()   → prepare the container (OCI bundle)
StartContainer()    → start it (containerd → shim → runc)
StopContainer()     → SIGTERM → SIGKILL
RemoveContainer()   → clean up
```

**ImageService**, image management:

```
PullImage()    → pull from the registry (OCI Image Spec)
ListImages()   → what is on this machine?
RemoveImage()  → delete from the cache
```

### What a sandbox is

The "sandbox" in CRI is not a container. It is the environment that every container in the same Pod shares:

- one network namespace (containers in the same Pod share one IP)
- a set of Linux namespaces (IPC, UTS)
- the pause container that holds those namespaces

When kubelet calls `RunPodSandbox()`, [containerd](chunk://containerd):

1. creates a [pause container](chunk://pause-container) (a small process that only sleeps)
2. the pause container's network namespace becomes the Pod's network namespace
3. **calls CNI** to set up the network inside that namespace
4. returns the sandbox ID to kubelet

Every container created after this joins the sandbox's namespaces. That is why containers in the same Pod share `localhost`: they all sit in the same network namespace that the pause container created.

---

## CNI: "connect this sandbox to the network"

Container Network Interface, the interface between the container runtime and the network plugin.

The full breakdown is in [Who assigns the Pod its IP](article://cni-network).

### Who calls CNI

CNI is **not called by kubelet**. The CRI runtime (containerd or CRI-O) calls it during `RunPodSandbox()`.

```
kubelet
  │ CRI: RunPodSandbox()
  ▼
containerd
  │ 1. create the pause container + network namespace
  │ 2. call the CNI plugin with that namespace
  ▼
CNI plugin (aws-vpc-cni)
  │ 1. allocate an IP from the VPC ENI
  │ 2. create a veth pair
  │ 3. move one end into the pod namespace
  │ 4. set up the routes
  │ return the IP to containerd
  ▼
containerd
  │ return the sandbox ID + IP to kubelet
  ▼
kubelet
  │ "sandbox is ready, next pull the image and create the container"
```

CNI happens inside CRI. kubelet does not call CNI directly and does not even know which CNI plugin is installed. containerd handles all of it.

---

## OCI: "here is the spec, go"

Open Container Initiative. OCI is two specs: the image format and the runtime configuration.

### Image Spec: how an image is packaged

When kubelet calls `CRI PullImage("nginx:latest")`, containerd pulls an OCI image from the registry. An image is a stack of layers:

```
nginx:latest
  ├─ manifest.json     ← "this image has 5 layers, with these digests..."
  ├─ config.json       ← "CMD nginx, EXPOSE 80, ENV PATH=..." (the image config, a different file from the runtime config.json below)
  └─ layers/
      ├─ sha256:a1b2c3...  ← base debian filesystem
      ├─ sha256:d4e5f6...  ← apt install nginx
      ├─ sha256:g7h8i9...  ← copy nginx.conf
      └─ ...
```

Each layer is a tar of filesystem differences (files added, changed or deleted). Layers are **content-addressable**: the name is the hash. Same content, same hash, so a layer can be shared across images. If `nginx` and `node` use the same debian base layer, that layer is downloaded once.

Docker invented this format and donated it to OCI. `docker pull`, `ctr pull` and `crictl pull` all fetch the same bytes.

### Runtime Spec: how a container is built

When kubelet calls `CRI CreateContainer()`, containerd prepares an **OCI bundle**:

```
/run/containerd/.../
  ├─ config.json    ← namespaces, cgroups, mounts, env, entrypoint
  └─ rootfs/        ← the unpacked image layers (union mount)
```

`config.json` is the [OCI](chunk://oci) Runtime Spec. [runc](chunk://runc) reads this file and knows how to build the container:

```json
{
  "process": {
    "args": ["nginx", "-g", "daemon off;"]
  },
  "linux": {
    "namespaces": [
      { "type": "pid" },
      { "type": "network", "path": "/proc/<pause-pid>/ns/net" }
    ],
    "resources": {
      "memory": { "limit": 268435456 }
    }
  },
  "mounts": [
    { "destination": "/data", "source": "/var/lib/kubelet/pods/<id>/volumes/..." }
  ]
}
```

`namespaces.network.path` points at the pause container's network namespace, so the new container joins the Pod network that already exists. CNI set that network up during `RunPodSandbox()`.

The paths in `mounts` are where CSI mounted the volume on the host. containerd writes them into `config.json` as bind mounts. runc reads them and mounts them into the container's filesystem.

**The four interfaces meet here: [CSI](chunk://csi) prepared the mount. [CNI](chunk://cri-cni) prepared the network namespace. CRI prepared the [OCI](chunk://oci) bundle. [runc](chunk://runc) reads all of it from one config.json.**

---

## The full picture

```
kubectl run nginx --image=nginx
  │
  ▼
API Server → etcd → Scheduler → pick a Node
  │
  ▼
kubelet (on that Node)
  │
  │  ┌──── CSI ──────────────────────────────────────────────┐
  │  │  external-provisioner watches the PVC                 │
  │  │    → CSI Controller: CreateVolume()                   │
  │  │    → AWS API: create the EBS volume                   │
  │  │  external-attacher watches the VolumeAttachment       │
  │  │    → CSI Controller: ControllerPublishVolume()        │
  │  │    → AWS API: attach the EBS volume to this EC2       │
  │  │  kubelet calls the CSI Node plugin:                   │
  │  │    → NodeStageVolume() (format + mount to staging)    │
  │  │    → NodePublishVolume() (bind mount into the pod dir)│
  │  │  result: the volume path is ready                     │
  │  └───────────────────────────────────────────────────────┘
  │
  │  ┌──── CRI: RunPodSandbox() ─────────────────────────────┐
  │  │  containerd creates the pause container               │
  │  │  containerd creates the network namespace             │
  │  │                                                       │
  │  │  ┌──── CNI ────────────────────────────────────────┐  │
  │  │  │  containerd calls the CNI plugin (aws-vpc-cni)  │  │
  │  │  │    → allocate an IP from the ENI secondary pool │  │
  │  │  │    → create a veth pair                         │  │
  │  │  │    → set up the routes                          │  │
  │  │  │  result: the Pod gets IP 10.100.x.x             │  │
  │  │  └─────────────────────────────────────────────────┘  │
  │  │                                                       │
  │  │  result: sandbox ready (namespace + network + IP)     │
  │  └───────────────────────────────────────────────────────┘
  │
  │  ┌──── CRI: PullImage() ─────────────────────────────────┐
  │  │  containerd → registry, pull nginx:latest             │
  │  │  OCI Image Spec: download manifest + layers           │
  │  │  Content-addressable: skip layers already present     │
  │  └───────────────────────────────────────────────────────┘
  │
  │  ┌──── CRI: CreateContainer() ───────────────────────────┐
  │  │  containerd prepares the OCI bundle:                  │
  │  │    config.json:                                       │
  │  │      namespace.network → the pause container's netns  │
  │  │      mounts → the volume paths from CSI               │
  │  │      resources → the limits from the Pod spec         │
  │  │    rootfs → the unpacked image layers                 │
  │  └───────────────────────────────────────────────────────┘
  │
  │  ┌──── CRI: StartContainer() ────────────────────────────┐
  │  │  containerd → containerd-shim-runc-v2 → runc          │
  │  │  runc reads config.json:                              │
  │  │    join the network namespace (set up by CNI)         │
  │  │    bind mount the volume (set up by CSI)              │
  │  │    set the cgroup limits                              │
  │  │    pivot_root into rootfs (OCI image layers)          │
  │  │    exec nginx                                         │
  │  │  runc exits. The shim stays. The container runs.      │
  │  └───────────────────────────────────────────────────────┘
  │
  ▼
kubelet updates the Pod status → API Server → etcd
  status: Running
  podIP: 10.100.x.x
```

---

## When it breaks

Each interface can fail on its own, and the symptom points at which one:

| Symptom | Which interface | Where to look |
|---|---|---|
| Pod stuck in `Pending` | none, the Scheduler found no Node | `kubectl describe pod` → Events |
| Pod stuck in `ContainerCreating`, waiting for the volume | **CSI** | CSI controller logs, VolumeAttachment objects |
| Pod stuck in `ContainerCreating`, no IP assigned | **CNI** | `aws-node` logs, `/var/log/aws-routed-eni/` |
| `ImagePullBackOff` | **CRI** (ImageService) | registry credentials, network path to the registry, a typo in the image name |
| `CrashLoopBackOff` | none, it is the app itself | the container started but the process exited right away; check `kubectl logs --previous` |
| `RunContainerError` | **CRI** (RuntimeService) | containerd logs, shim logs, runc debug |
| Container runs but has no network | **CNI** | the CNI plugin did not run, or it failed |
| Container runs but the volume is empty | **CSI** | the mount succeeded but the PVC is wrong, or provisioning failed |

---

## The four interfaces side by side

| | CSI | CRI | CNI | OCI |
|---|---|---|---|---|
| **Who calls it** | kubelet | kubelet | containerd (inside CRI) | containerd (inside CRI) |
| **Protocol** | gRPC over Unix socket | gRPC over Unix socket | exec binary + JSON stdin | spec (files, not network) |
| **When** | before CRI | after CSI | during RunPodSandbox | during Pull + Create |
| **Runs as** | Pods (Controller + Node DaemonSet) | system service (containerd) | binaries in /opt/cni/bin/ | library/tool (runc) |
| **This cluster** | EBS CSI + EFS CSI | containerd | aws-vpc-cni | runc |
| **Alternatives** | Ceph, NFS, Longhorn | CRI-O, cri-dockerd | Calico, Cilium, Flannel | gVisor, kata |

CNI is not gRPC. It execs a binary and feeds it JSON on stdin, the simplest protocol of the four. No daemon, no socket. containerd execs the binary once and gets an IP back.

OCI is not a protocol at all. It is a spec for file formats. It has no server and no client. It only defines what config.json and the image layers look like. runc reads the files, and no network is involved.

---

## What the interfaces give and what they cost

Each interface is a boundary where the implementation can be swapped without changing kubelet. But every extra interface is one more place to check when something fails, and one more set of versions to keep aligned (version skew).

The gain: the same `kubectl run nginx` runs Calico + Ceph on bare metal, VPC CNI + EBS on AWS, and kind + local storage on a laptop. kubelet never changes. Only the implementation behind the interface does.

K8s started out written directly against Docker. CRI appeared in 2016, and it took another six years before dockershim was removed in 1.24.

---

## References

- [CRI API protobuf definition](https://github.com/kubernetes/cri-api/blob/v0.33.1/pkg/apis/runtime/v1/api.proto)
- [CSI Spec](https://github.com/container-storage-interface/spec/blob/master/spec.md)
- [CNI Spec](https://www.cni.dev/docs/spec/)
- [OCI Image Spec](https://github.com/opencontainers/image-spec)
- [OCI Runtime Spec](https://github.com/opencontainers/runtime-spec)
- [K8s needed Docker. Then it didn't.](https://jialin00.com/v2/container-runtime-evolution)
- [inside containerd: how shim and runc actually work](https://jialin00.com/v2/containerd-shim-and-runc)
- [Who assigns the Pod its IP](article://cni-network)
