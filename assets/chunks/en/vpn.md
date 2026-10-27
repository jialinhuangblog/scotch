---
title: "VPN (Site-to-Site)"
slug: vpn
brief: "An encrypted tunnel across clouds or data centers. IPSec encrypts, BGP exchanges the routing tables automatically."
date: 2026-03-14
updated: 2026-10-18
revisions: 3
---

# VPN (Site-to-Site)

An encrypted tunnel between two separate networks. The office network is 192.168.10.0/24, the VPC on AWS is 10.200.0.0/16, and the public internet sits in between. A machine in the office, 192.168.10.5, connects to 10.200.1.20 inside the VPC, and the packet travels like this:

```text
192.168.10.5 → the office VPN gateway
  the gateway encrypts the whole packet with IPSec and wraps it in a new IP header,
  source: its own public IP, destination: the AWS gateway's public IP
→ public internet, where only the two gateways' public IPs and a blob of ciphertext are visible
→ the AWS VPN gateway decrypts and takes out the original packet
→ 10.200.1.20
```

Even if someone intercepts it on the way, the content is unreadable. They cannot even work out who inside the networks is talking to whom, because the inner IP header is encrypted along with the rest.

## The difference from VPC Peering

VPC Peering connects networks inside the same cloud and does not touch the internet. Site-to-Site VPN connects across clouds or data centers, over the internet but encrypted.

```
GCP VPC ←─ VPC Peering ─→ GCP VPC     (same cloud, direct)
GCP VPC ←─ VPN tunnel  ─→ AWS VPC     (across clouds, encrypted tunnel)
```

## What each side needs to set up a VPN

- Its own VPN gateway with a public IP
- The other gateway's public IP, plus the other side's ASN (used by BGP below)
- Tunnel settings: the shared pre-shared key, the IKE version, the encryption algorithms

## BGP and ASN

Once the tunnel is up, the routers on both sides still have to learn which networks live on the other end. Writing them in by hand works, but every new network on the other side means another change. BGP (Border Gateway Protocol) lets the two sides exchange them automatically: the office announces "192.168.10.0/24 is on my side", AWS announces "10.200.0.0/16 is on my side", and both routing tables update on their own. When AWS later adds 10.201.0.0/16, one announcement is enough, and nothing changes on the office side.

Each side needs an ASN (Autonomous System Number) as its BGP identity. The two ASNs must differ.

## Why more than one tunnel

A VPN tunnel runs over the public internet. If an ISP line goes down or a node on the path fails, the tunnel drops. With a single tunnel, a dropped VPN means the two sides lose contact.

Every AWS Site-to-Site VPN connection creates 2 tunnels automatically. On the AWS side the two end in different Availability Zones with different public IPs, so when one AWS endpoint goes down for maintenance, traffic moves to the other tunnel on its own. The office side gets no such protection: both tunnels end at the same customer gateway on the same ISP line, and when that line goes down both tunnels drop together. To cover a failure on this side, the AWS documentation adds a second VPN connection to a second customer gateway.

GCP's HA VPN Gateway has 2 IPs (the plain Cloud VPN Gateway has 1). GCP's official tutorial for connecting to AWS also creates two customer gateways and two VPN connections on AWS. The first GCP IP takes the 2 tunnels of the first connection, the second IP takes the 2 of the second, 4 tunnels in all. When any one drops, BGP moves the traffic to the tunnels that still work.
