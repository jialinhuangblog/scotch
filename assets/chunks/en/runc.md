---
title: "runc"
slug: runc
brief: "The low level runtime. It reads the OCI config.json, creates namespaces + cgroups, execs the process, and exits. A one shot tool."
article: four-interfaces-one-pod
date: 2026-04-12
updated: 2026-10-18
revisions: 2
---

# runc

runc is the default low level runtime of the OCI (Open Container Initiative). Its only job is to turn an OCI bundle (a directory holding a rootfs plus a config.json) into a running container.

## What it does

Walk through it with an nginx container. In the bundle directory, `rootfs/` is the unpacked nginx image, and `config.json` says to run `nginx -g 'daemon off;'`, with a memory limit of 256MB and a list of which namespaces to create.

When containerd starts this container, the shim first runs `runc create web1`, then `runc start web1`, and runc does the following in order:

1. Read `config.json`
2. Create the Linux namespaces (pid, net, mnt, ipc, uts). From this moment the new process sees PIDs starting from 1 and cannot see the host's other processes
3. Set up the cgroup, placing the process in a group with a 256MB memory limit
4. `pivot_root`, swapping the root directory for `rootfs`, so the `/etc/nginx` it sees is the one from the image
5. `runc create` exits at this point and leaves a process called `runc init` waiting; nginx has not started yet
6. `runc start` tells `runc init` to `exec` nginx; that process becomes nginx from here on, and `runc start` exits too

Afterwards, `ps` on the host shows the nginx master and its workers. The master has a PID such as 48213, its parent is `containerd-shim-runc-v2`, and no runc process is in the list. Inside the container the same master shows up as PID 1.

Running `runc run web1` by hand in a shell is different. `runc run` does create and start in one command, but without `--detach` runc does not exit: it stays as nginx's parent, waits for nginx to end, and then exits with nginx's exit code. In one real run, `runc run web1` had PID 23 in `ps`, and the nginx master's parent was 23.

On the containerd path, runc exits after each command. So who is the container's parent? `containerd-shim-runc-v2`. It stays behind, calls `waitpid()` to collect the exit code, and reports it to containerd. When nginx dies, the shim is the one that receives exit code 1, and only then does containerd know to report it to the kubelet.

## Alternatives

| Runtime | Difference |
|---|---|
| **gVisor (runsc)** | Intercepts syscalls with a user space kernel, one more layer of isolation |
| **kata-runtime** | Runs each container inside a lightweight VM, fully isolating the kernel |

All three are OCI compatible. k8s picks one with a RuntimeClass, and containerd calls the matching runtime according to its config.
