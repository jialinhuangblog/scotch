---
title: "Subnet & CIDR"
slug: subnet-cidr
brief: "CIDR expresses an IP range with a prefix length; a subnet is a piece cut out of the VPC's IP range."
date: 2026-03-14
---

# Subnet & CIDR

## CIDR

CIDR (Classless Inter-Domain Routing) writes an IP range in the form `10.42.0.0/16`. `/16` means the first 16 bits are fixed and the remaining 16 bits are the usable address space, which is 65,536 IPs.

```
10.42.0.0/16  → 10.42.0.0 ~ 10.42.255.255 (65,536 IPs)
10.42.0.0/18  → 10.42.0.0 ~ 10.42.63.255  (16,384 IPs)
10.42.0.0/24  → 10.42.0.0 ~ 10.42.0.255   (256 IPs)
```

The bigger the number, the smaller the range. `/16` is the whole building, `/18` is one floor, `/24` is one office.

## Subnet

A subnet is a piece cut out of the VPC's CIDR. On AWS, each subnet is bound to one Availability Zone; on GCP, a subnet belongs to the whole region.

```
VPC: 10.42.0.0/16
├── subnet-nodes:    10.42.0.0/18     (for nodes)
├── subnet-pods:     10.42.64.0/18    (for k8s pods)
└── subnet-services: 10.42.128.0/18   (for k8s services)
```

GKE's VPC-native mode requires pods and services to each have their own CIDR block: nodes run in one block, pod IPs come from another, and the blocks do not overlap. EKS's default VPC CNI assigns pod IPs straight from the subnet the node is in, and services use a separate CIDR that is not inside the VPC.

## Planning rule

The CIDRs of different environments (dev, staging, prod) must not overlap. Once a VPN or VPC Peering connects them, the route table relies on distinct CIDRs to decide which side traffic should go to.
