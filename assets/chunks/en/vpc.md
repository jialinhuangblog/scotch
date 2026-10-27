---
title: "VPC"
slug: vpc
brief: "A private network in the cloud. A VPC has its own private IP range, and nothing outside can reach the resources inside directly."
date: 2026-03-14
updated: 2026-10-18
revisions: 2
---

# VPC

A VPC (Virtual Private Cloud) is an isolated private network carved out on a public cloud.

## Why it is needed

The cloud is shared. One physical machine may run workloads from different companies, and it is normal for two companies' VMs to both have the IP 10.42.0.5, because each sits in its own VPC. A packet leaving a VM is tagged with its VPC, and the underlying network only delivers it to machines in that same VPC. AWS calls it a VPC and so does GCP; the idea is the same: one private IP range (a CIDR block), and only resources inside the VPC can talk to each other.

## Basic structure

```
VPC (10.42.0.0/16)
├── Subnet A (10.42.0.0/18)  ← us-west-1a, public
├── Subnet B (10.42.64.0/18) ← us-west-1b, private
└── Internet Gateway          ← the way out
```

The VPC defines the CIDR range, here 10.42.0.0/16, 65,536 IPs in all. Subnets carve smaller ranges out of it: Subnet A takes 10.42.0.0 to 10.42.63.255, Subnet B takes 10.42.64.0 to 10.42.127.255. On AWS each subnet is tied to one Availability Zone; on GCP a subnet spans the whole region.

## Public vs private subnet

On AWS, the only difference between the two subnets is the route table. Subnet A's route table has a line `0.0.0.0/0 → Internet Gateway`. Subnet B's does not; it has `0.0.0.0/0 → NAT Gateway` instead.

GCP works differently. On GCP the route table is defined for the whole VPC network, and every subnet in that network shares it; a single subnet cannot have its own route table. So on GCP, public versus private depends on whether the VM has an external IP. A VM with one goes out through the default route; a VM without one needs Cloud NAT to get out. The walkthrough below follows the AWS setup.

Follow two packets. An app server at 10.42.70.3 in Subnet B wants to fetch a package from pypi. The destination is not inside 10.42.0.0/16, so the route table sends it to the NAT Gateway, which swaps the source for its own public IP and sends it out through the Internet Gateway. When the reply comes back, the NAT swaps the address back to 10.42.70.3. The outside world only ever sees the NAT's public IP.

The other way around, someone on the internet sends a packet straight to 10.42.70.3. That is a private IP, the internet has no route to it at all, and the NAT Gateway only lets in replies to connections it opened itself, so the packet never arrives. A load balancer in Subnet A of the same VPC sending to 10.42.70.3 gets through, because the destination is inside 10.42.0.0/16 and takes the internal VPC route.

So most workloads, the DB, the app servers, the k8s nodes, go in a private subnet: they can get out, nothing gets in. Only the load balancer and the bastion host go in the public subnet with a public IP, as the one entrance from outside.
