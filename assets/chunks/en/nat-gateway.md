---
title: "NAT Gateway"
slug: nat-gateway
brief: "The exit for a private subnet. Internal resources reach out through the NAT Gateway's public IP, and the outside never sees the internal IP."
date: 2026-03-14
updated: 2026-10-17
revisions: 1
---

# NAT Gateway

A NAT Gateway (Network Address Translation Gateway) lets resources in a private subnet reach out to the internet, while the internet cannot open connections back in.

## How it works

An EC2 in a private subnet (IP 10.42.1.5) wants to call an external API at 203.0.113.80 on port 443. 10.42.x.x is a private address; routers on the internet do not recognize it, so even if the packet got out, nobody could reply. So the private subnet's route table points 0.0.0.0/0 at the NAT Gateway.

As the packet passes through, the NAT Gateway rewrites the source from 10.42.1.5:40001 to its own public IP plus a port it picks, say 54.10.20.30:61000, and records one row in its table:

```text
internal              outside
10.42.1.5:40001   ↔  54.10.20.30:61000  → 203.0.113.80:443
10.42.1.7:40001   ↔  54.10.20.30:61001  → 203.0.113.80:443
```

The external API sees 54.10.20.30:61000 as the source and sends its reply there. The NAT Gateway looks up the table, finds that 61000 maps to 10.42.1.5:40001, rewrites the destination back and forwards the packet into the subnet. Another EC2, 10.42.1.7, happens to use port 40001 to call the same API; NAT gives it 61001, and the outside port keeps the two connections apart. That is how one public IP serves the whole subnet.

Why does the reverse direction fail? Someone on the internet sends a packet straight to 54.10.20.30:62000. There is no row for it in the table, the NAT Gateway has no idea who to forward it to, and drops it.

## Why not just use a public subnet

A DB server has no need to be reachable from the internet, and should not be. In a private subnet, not even SSH gets in (except through a bastion or VPN), yet the DB can still go through NAT to download patches or call external APIs.

## Cost

A NAT Gateway is billed per hour of use plus the traffic it processes, a common surprise on AWS bills. With heavy outbound traffic the cost adds up fast. Some teams replace it with a NAT Instance (an EC2 they run themselves): cheaper, but high availability is on them to maintain.
