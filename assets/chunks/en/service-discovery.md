---
title: "Service Discovery"
slug: service-discovery
brief: "How services find each other. DNS based (k8s CoreDNS) vs registry based (Consul, etcd)."
date: 2026-03-14
updated: 2026-10-18
revisions: 3
---

# Service Discovery

The order service needs to call the inventory service. Inventory started with 3 instances at 10.1.2.7, 10.1.3.4 and 10.1.5.9. Yesterday's scale up added a fourth at 10.1.6.2, so there are four now, and one may be gone tomorrow. The order service cannot hard code these IPs, so something has to answer "where is inventory right now" at any moment.

## DNS based and registry based

**DNS based** uses the CoreDNS built into k8s. The order service knows only one name, `inventory`. Before sending a request it asks DNS, and CoreDNS answers `inventory.default.svc.cluster.local` → `10.96.0.12`. That 10.96.0.12 is not any Pod. It is the Service's ClusterIP, a virtual IP that never changes. The order service sends to 10.96.0.12, and as the packet leaves, the iptables or IPVS rules that kube-proxy maintains on the node rewrite the destination to one of 10.1.2.7, 10.1.3.4, 10.1.5.9 or 10.1.6.2. When Pods come and go, the kube-proxy rules change while the ClusterIP that DNS returns stays the same, so the client never holds a stale answer.

Pointing DNS straight at instance IPs is different, for example one name with three A records in the VM era. A DNS answer carries a TTL, say 60 seconds. 10.1.5.9 dies at second 10 and is removed from DNS, but the order service last asked at second 5 and its cache has not expired, so for the next 55 seconds it keeps sending to 10.1.5.9 and every call times out.

**Registry based** uses a registry such as Consul, etcd or ZooKeeper. When an inventory instance starts, it registers itself: "I am inventory, 10.1.6.2:8080". The order service asks the registry for the full inventory list, gets four IPs and picks one itself, or opens a watch on the registry and is notified whenever the list changes.

How a dead instance leaves the list differs across the three. In Consul the agent checks actively: for example, every 10 seconds it sends an HTTP request to 10.1.6.2:8080, and when the check fails it marks the instance unhealthy, so a query for healthy instances no longer returns it. etcd does not check anyone. The instance takes a lease when it registers, for example with a TTL of 10 seconds, and then renews it on its own schedule. When the instance dies, the renewals stop, the lease expires 10 seconds later, and etcd deletes the registration. ZooKeeper works like etcd: the instance creates an ephemeral node, and when the session that created it ends, the node is deleted. The etcd TTL is not the same thing as the DNS TTL above. A DNS TTL is how long the client caches the answer, and the client does not ask again before it expires. An etcd TTL is how long the registry waits for a renewal, and once the registration is deleted, every client with a watch is notified right away. So a dead instance leaves the list within one TTL or one check interval, instead of being called for another 55 seconds because of a client cache, as in the DNS example.

## Service discovery in k8s

k8s combines DNS with kube-proxy: CoreDNS resolves the name to a fixed ClusterIP, kube-proxy rules forward from the ClusterIP to the actual Pods, and the rules update on their own as Pods come and go. The caller only knows the Service name. How many Pods sit behind it and which node they run on is not its concern.
