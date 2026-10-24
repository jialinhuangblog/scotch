---
title: "Container"
slug: container
brief: "Process isolation at the OS level with namespaces + cgroups. Pack the app + its dependencies into a portable image."
date: 2026-03-14
updated: 2026-10-18
revisions: 3
article: before-k8s
---

# Container

> The same app runs fine on a laptop, then hits a pile of environment problems on the server. How do you make it behave the same everywhere?

A container is just an ordinary process on the host, with its view and its resources restricted so that it believes it owns the whole machine.

## Two Linux mechanisms

**Namespaces**

Isolate the view. Run `docker run nginx` on the host, and on a machine with 5 cores the host's `ps` gains 6 nginx processes, listed alongside a few hundred others: the master as PID 5593 and 5 workers under it as 5644 to 5648. There are 5 workers because the official image's nginx.conf says `worker_processes auto`, one per core. Inside the container, listing `/proc` (the nginx image has no `ps`) shows the same 6 processes: the master as PID 1, the workers as 29 to 33, plus only the shell that ran the listing. It is the same set of processes, and the two sides see different PIDs because they live in their own pid namespace. Every process listed inside the container is also in the host's `ps`; none of the few hundred other host processes show up inside the container. The filesystem and the network work the same way: the `/` it sees is the unpacked image directory, the eth0 it sees is a virtual NIC, and the host's real `/etc` and the ports other containers open are invisible to it. It is not a virtual machine. It still runs on the host's kernel; it just cannot see the other processes.

**Cgroups**

Limit resources. `docker run --memory 256m --cpus 0.5 nginx` makes the kernel place the process in a group. When memory use reaches 256MB, the kernel first reclaims what it can drop inside this group, such as the page cache left by reading files. In a real run, a container with a 64MB limit read a 192MB file three times: its usage hit the limit 3,236 times, every one was resolved by reclaim, and no OOM happened. Trouble starts only with memory that cannot be reclaimed. The heap memory nginx asks for has nothing to drop, so with no swap available, once it goes over the limit the kernel picks one process in this group and kills it. That may be one of the workers, not necessarily PID 1. The other processes on the host are unaffected. For CPU it may run at most 50 milliseconds in every 100; when it is busy the scheduler pauses it until the next 100 millisecond slice.

## Image: pack the app and its environment together

A Dockerfile defines the image: OS base layer + app code + dependencies. `docker build` produces the image, `docker run` runs the container.

The same image that runs on a laptop also runs on the production server. The laptop having Node 22 and the server Node 18 does not matter, because the Node used inside the container is the copy in the image, not the host's.

## Containers do not schedule across machines

Running containers on one machine is simple. But ten machines, or hundreds? Which container goes on which machine, who restarts it when it dies, how traffic is split among them: the container itself has no mechanism for any of that.

What schedules all these containers is k8s.
