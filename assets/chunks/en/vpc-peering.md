---
title: "VPC Peering"
slug: vpc-peering
brief: "Two VPCs connected directly, bypassing the internet with low latency, but their CIDR ranges must not overlap."
date: 2026-03-14
updated: 2026-10-18
revisions: 2
---

# VPC Peering

A direct connection between two VPCs. Traffic stays on the cloud's internal network and never touches the public internet.

## When it is used

One company has two VPCs: the prod VPC runs the app, the managed-service VPC runs Redis and the DB. The app needs to reach the DB, but nobody wants to give the DB a public IP and expose it to the internet.

```
prod-network VPC (10.42.0.0/16)
        ↕  VPC Peering
managed-service VPC (10.30.0.0/16)
```

Once the peering is set up, each side's route table needs one more line. On prod it is `10.30.0.0/16 → peering connection`; on managed-service it is `10.42.0.0/16 → peering connection`. Who adds that route differs between the two clouds. GCP exchanges the subnet routes of both sides automatically when the peering becomes active. AWS does not: after the peering shows Active, the owner of each VPC still has to add the route by hand, and without it packets have no route to 10.30.0.0/16. With the routes in place, the app at 10.42.5.8 in prod sends a packet to the DB at 10.30.2.4, the route table lookup finds the destination inside 10.30.0.0/16 and takes the peering route. The packet carries private IPs the whole way, passes through no NAT and no internet gateway, and the latency is about the same as inside one VPC. The DB never has a public IP.

This pattern is common between GKE and managed Redis or a managed DB. GCP calls it VPC Network Peering; AWS calls it a VPC Peering Connection.

## Limits

**CIDR ranges must not overlap.** If both VPCs used 10.42.0.0/16, then when the app sends to 10.42.2.4, the router could not tell whether that is a machine in its own VPC or the DB on the other side. So the cloud checks at the moment the peering is created: AWS and GCP both refuse to create a peering between overlapping CIDRs. The ranges have to be kept apart when the CIDRs are planned, like 10.42 on one side and 10.30 on the other above; changing a CIDR later amounts to rebuilding the VPC.

**It is not transitive.** A peers with B and B peers with C, but a packet from A to C stops at B. This is a limit of peering itself: adding a route toward C in B's route table does not help, because neither AWS nor GCP peering does transitive routing. AWS does not even let A use B's internet gateway, NAT or VPN. For A to reach C, a separate A to C peering is needed. Fully connecting ten VPCs takes 45 peerings, which is the point where a hub such as a Transit Gateway replaces them.

**Not across clouds.** VPC Peering only works within one cloud, AWS to AWS or GCP to GCP. Connecting across clouds takes a VPN or a dedicated line.
