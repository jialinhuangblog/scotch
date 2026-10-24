---
title: "Who assigns the Pod its IP?"
slug: cni-network
date: 2026-04-11
updated: 2026-10-17
revisions: 2
subtitle: "A freshly created container has no network. The CNI plugin connects it to the network and assigns its IP."
chapter: "extras"
tags: [k8s, cni, networking, container, veth, linux]
related: [k8s-planes, packet-journey, four-interfaces-one-pod]
---

# Who assigns the Pod its IP?

The Pod is running. Run `kubectl get pod -o wide` and you see the IP `10.244.1.5`.

Where did this IP come from? The CNI (Container Network Interface) plugin assigned it. Neither kubelet nor containerd assigns IPs.

---

## A container is born without a network

Every container runs in its own network namespace. A network namespace is a Linux kernel feature that gives a process its own set of network interfaces, routing table and iptables rules, fully isolated from other processes.

A newly created netns has nothing in it, only a `lo`:

```bash
ip netns add pod-a
ip netns exec pod-a ip link
# 1: lo: <LOOPBACK> mtu 65536
```

There is no `eth0` and no IP, so right now this pod cannot reach anything outside its namespace.

---

## A cable through the wall: veth pair

Linux has a kind of virtual network cable called `veth`. It always comes in pairs. A packet sent into one end comes out of the other end at once, and the same in the opposite direction.

Picture the host and the pod as two rooms with a wall between them. The veth pair is a cable through the wall: push a packet in on this side and it drops out on the other side at once.

```bash
# create a veth pair; both ends are in the host's room for now
ip link add veth_host type veth peer name veth_pod

# move the pod end into pod-a's room and relabel it eth0
ip link set veth_pod netns pod-a name eth0

# bring both ends up (power on)
ip link set veth_host up
ip netns exec pod-a ip link set eth0 up
#└── into pod-a's room ──┘ └ run this inside ┘
```

Now:

```
[host netns]      [pod-a netns]
  veth_host  ←──→   eth0
```

`eth0` is the network card the pod sees. A packet goes in from inside and comes out at the `veth_host` end.

---

## One node has dozens of Pods

One veth pair connects only one pod to the host. A node with N pods has N veth pairs, but the host ends of these veths are not connected to each other:

```
veth_host_a ← pod-A
veth_host_b ← pod-B
veth_host_c ← pod-C
```

How does pod-A send a packet to pod-B? It cannot. There is no connection between them.

The fix is a **bridge**. Picture a switch placed in the host's room. The host end of every cable through the wall plugs into a port on this switch, and the switch lets them reach each other.

```bash
# put a switch in the host's room, called cni0
ip link add cni0 type bridge
ip link set cni0 up

# plug the host end of every cable into the switch, then power on
ip link set veth_host_a master cni0 && ip link set veth_host_a up
ip link set veth_host_b master cni0 && ip link set veth_host_b up
ip link set veth_host_c master cni0 && ip link set veth_host_c up
```

`master cni0` = "this cable is plugged into the switch cni0". Once plugged in, the switch looks at the dst MAC to decide which port to forward to, exactly the behavior of a physical switch, only all of it is simulated in software.

Now all three pods are on the same L2 segment. When pod-A sends a packet to pod-B, the path is:

```
pod-A eth0 → veth_host_a → bridge(cni0) → veth_host_b → pod-B eth0
```

The packet never leaves the node. The bridge forwards it directly.

---

## Where the IP comes from: IPAM (IP Address Management)

The bridge is wired up, but the pod's `eth0` still has no IP.

CNI pulls IP assignment out into a separate sub plugin called IPAM (IP Address Management). The most common one is `host-local`: each node has a subnet assigned to it (say `10.244.1.0/24`), and host-local keeps a local file recording which IPs are already taken:

```
/var/lib/cni/networks/mynet/10.244.1.2  ← this IP is taken by containerID xxx
/var/lib/cni/networks/mynet/10.244.1.3  ← this IP is taken by containerID yyy
```

Every time a new pod needs its network set up, IPAM finds an IP that has no file yet, creates that file, and returns the IP to the caller above it. When the pod is deleted, IPAM deletes the file and the IP can be assigned again.

CIDR (Classless Inter-Domain Routing) is a contiguous range of IPs written with a prefix length, for example `10.244.1.0/24`. Kubernetes node CIDR allocation guarantees that no two nodes' subnets overlap, and each node hands out IPs only from its own subnet, so no two pod IPs in the whole cluster are the same.

---

## How a packet crosses nodes

Two pods on the same node go through the bridge and never leave the machine. But with pod-A on node-1 and pod-B on node-2, there is a physical network in between. Each node needs its routing table or a VXLAN device set up first, or the packet cannot reach the other side.

**The premise Flannel and Calico share:** when a node joins the cluster, k8s first gives it a pod subnet that overlaps with no other (node-1 gets `10.244.1.0/24`, node-2 gets `10.244.2.0/24`; this is the node CIDR from the IPAM section above, and host-local hands out IPs from it). Every example in this section assumes host-local. Flannel uses it, and Calico can be configured to use it, but Calico's default calico-ipam works differently; that comes at the end of the Calico part. At this point there are no pods yet. It only settles "future pods on this machine use this range". Later, when pod-B is actually scheduled onto node-2, the IPAM on that node picks a concrete IP (`10.244.2.5`) out of that range for it.

With host-local, a pod's IP always falls inside the subnet of the node it runs on. So from the `10.244.2` prefix of `10.244.2.5` alone, you know it is on node-2. The only question left is "which physical machine does `10.244.2.0/24` map to", and Flannel and Calico answer it in two ways.

**Flannel (VXLAN): put the packet in an envelope**

VXLAN (Virtual Extensible LAN) is a tunnel protocol that wraps an L2 packet inside UDP and sends it out.

Ahead of time, flannel keeps a table in a shared place (etcd or the k8s API): "which pod subnet → which node's real IP". The flanneld on every node can read it and syncs it locally.

When a packet has to cross nodes, node-1's routing table hands any packet whose destination is another node's subnet to `flannel.1` (a VXLAN device). `flannel.1` looks up the table, finds that `10.244.2.0/24` is on node-2 at `192.168.1.20`, stuffs the whole pod packet into a UDP packet with the real IPs node-1 → node-2 on the outside, and sends it out through the physical network card. `flannel.1` on node-2 receives it, strips the outer layer, restores the pod packet inside, hands it to the bridge, and it goes into pod-B.

```
pod-A eth0 → bridge → flannel.1(VXLAN) → node-1 eth0 → network → node-2 eth0 → flannel.1(unwrap) → bridge → pod-B eth0
```

It is like mailing a letter. "10.244.2.5" is an address the post office does not recognize, so the letter goes into a big envelope with node-2's real address on the outside. On arrival the envelope is opened and the letter inside is delivered locally. The gain is that the underlying network needs no cooperation at all. The cost is one extra wrap and unwrap per packet, so latency and CPU use are slightly higher.

**Calico (BGP): write the pod subnets into every node's routing table**

Calico uses no envelope. Instead it fills in the routing tables ahead of time. The setup order:

1. When node-2 joins, it gets the subnet `10.244.2.0/24`. Its real IP `192.168.1.20` was already there (the machine's network card).
2. The [BGP](chunk://bgp) speaker running on node-2 announces to the other nodes: "`10.244.2.0/24` goes through me, `192.168.1.20`".
3. The other nodes receive it and write it into their own kernel routing table.
4. These steps finish before any pod is born. Later, when pod-B gets `10.244.2.5`, it falls inside a subnet already announced, so there is no separate announcement for it.

Only after the setup do packets start moving. node-1's routing table looks like this:

```text
10.244.1.5/32  dev cali1a2b3c    # own pods, one /32 per pod pointing at its veth (Calico has no bridge)
10.244.2.0/24 via 192.168.1.20   # node-2's pods, next hop is node-2
```

pod-A sends to `10.244.2.5`. node-1's kernel matches this IP against the table, the longest prefix hits the second line, and it forwards the packet straight to `192.168.1.20` as an ordinary IP packet. `192.168.1.20` is an address that really exists on the physical network, so normal routing delivers the packet. No envelope to put on, none to take off.

```
pod-A eth0 → caliXXX → node-1 kernel routing → node-1 eth0 → IP routing → node-2 eth0 → kernel routing → caliYYY → pod-B eth0
```

BGP's job is to fill in these `via` entries on every node automatically, so nobody writes them by hand. Without the envelope step, latency is lower than with VXLAN. The cost is that the underlying network has to run BGP, or every node has to be on the same L2.

Everything above is Calico with host-local. Calico's default IPAM, calico-ipam, does not hand a node a `/24` when it joins. It cuts the whole pool into `/26` blocks of 64 IPs. Only when the first pod on node-2 needs an IP does node-2 get a block, for example `10.244.2.0/26`. When those 64 run out, it gets another block, and the next block is not always the adjacent one. BGP then announces these `/26` blocks. The Calico docs also say it can give a pod an IP that is in none of its node's blocks. For such an IP, the prefix alone does not tell you which node the pod is on, and the "one subnet maps to one machine" link from step 2 no longer holds.

---

## What CNI is

CNI is just a contract: **the plugin is a binary, the container runtime calls it through environment variables and stdin, and reads the result back from stdout.**

CNI 1.1 defines six values of `CNI_COMMAND`: `ADD` (set up the network), `DEL` (clean up), `CHECK` (verify), `STATUS` (is the plugin ready), `GC` (remove leftover resources nobody uses), `VERSION` (query the version). The IPAM assignment from earlier happens inside `ADD`, and releasing the IP on pod deletion is `DEL`.

```bash
CNI_COMMAND=ADD \
CNI_CONTAINERID=abc123 \
CNI_NETNS=/var/run/netns/abc123 \
CNI_IFNAME=eth0 \
CNI_PATH=/opt/cni/bin \
/opt/cni/bin/bridge < network-config.json
```

`bridge`, `calico`, `flannel` are all binaries under `/opt/cni/bin/`. The runtime finds one, execs it, passes in the context, and the binary sets up the network, prints the result JSON to stdout, and exits.

The caller of CNI is not kubelet. It is containerd's CRI (Container Runtime Interface) plugin. While handling `RunPodSandbox` it creates the netns, then passes the netns path to CNI.

This design makes switching the network solution simple: swap the binary in `/opt/cni/bin/`, change one config JSON, and nothing else has to move.

---

## The whole flow

```
kubelet calls containerd: RunPodSandbox
  → containerd creates the pause container (which holds the netns)
  → containerd calls CNI ADD
    → bridge plugin: create the veth pair, plug it into the cni0 bridge
    → IPAM(host-local): assign 10.244.1.5, set the IP and route on eth0
  → CNI returns the result
  → the pod's eth0 has an IP, can leave the node, can communicate with other pods
```
