---
title: "How deployment was done before k8s"
slug: before-k8s
date: 2026-03-14
updated: 2026-10-17
revisions: 1
subtitle: "From manual SSH, to containers, to the orchestrator. Each generation fixes the trouble of the one before."
chapter: "devops"
tags: [k8s, container, deploy, devops, desired-state]
related: [k8s-planes, helm-deep, deploy-practice]
---

# How deployment was done before k8s

3am, the phone rings. The production server is down.

Open the laptop, SSH in, read the logs, find an OOM (out of memory, the kernel killed the process). Restart the process by hand. Wait three minutes, confirm it recovered. Go back to sleep.

This was daily life in 2014.

---

## The manual era: one server, one person

The earliest deployments looked like this:

```
laptop → scp app.jar user@server:/opt/app/ → ssh user@server "systemctl restart app"
```

One server. One deploy script. Sometimes not even a script, just a list of commands kept in someone's head.

How do you scale? Buy a bigger machine. Not enough CPU? Upgrade. Not enough memory? Add some. This is vertical scaling. It has a ceiling, and it is expensive.

Horizontal scaling? Buy a few more machines. But now there are three servers, and each one needs:

1. The same OS version installed
2. The same runtime installed (Java 8? Java 11?)
3. The same system libraries installed
4. The same config files copied over
5. Nginx configured to split traffic across the three

Three is manageable. What about thirty?

### Snowflake server

Every server is unique. Server A has Java 11. Server B was upgraded to Java 17 by hand at some point, nobody knows when. Server C has a mysterious environment variable that some engineer set two years ago. Nobody knows why, but remove it and things break.

This is called a snowflake server. Like snowflakes, no two look alike, and none can be rebuilt from a recipe. Because nobody knows what is actually installed on the machine, nobody dares touch it.

### Fear of deploying

In this world, deploying is dangerous. Every deploy can fail because of environment differences. So teams deploy less often, stretching from once a week to once a month.

The fewer the deploys, the bigger the accumulated change, the more likely something goes wrong, and the less anyone dares to deploy.

---

## Containers: package everything

In 2013 Docker appeared. The problem it set out to solve was "it works on my machine, it breaks on the server".

### Before

The app depends on Node.js 18, libssl 1.1, and a specific version of imagemagick. Everything is installed locally, and it runs fine.

Push it to the server: Node.js is 16, libssl is 3.0, imagemagick is not installed. Broken.

Then spend two hours installing the missing pieces server by server. If the next deploy adds a new dependency, you go through it all again.

### After

```dockerfile
FROM node:18-alpine
COPY package*.json ./
RUN npm ci
COPY . .
CMD ["node", "server.js"]
```

`docker build` packages the app and all its dependencies into one image. Once built, the image never changes. What runs locally and what runs in production is the same image.

So there is no more matching environments server by server. The image is the deployment artifact. Like a compiled binary, the same copy produces the same result on whichever machine runs it.

### What a container really is

A container is not a virtual machine. There is no guest OS and no hypervisor. It is just a Linux process, constrained by two kernel features:

Namespaces isolate what a process can see. The process inside the container sees PIDs starting from 1, cannot see the host's filesystem, and has its own network stack. From the inside it looks like it owns the whole computer.

Cgroups limit resources. At most 0.5 CPU cores. At most 256MB of memory. Go over and it is OOM killed.

Namespaces isolate, cgroups limit, and the two together are a container. Startup takes milliseconds, not the minutes a virtual machine needs, because there is no OS to boot.

### What containers solved

| Before | After |
|---|---|
| Environment differences make deploys fail | The image is immutable and the same everywhere |
| Snowflake server | The server only needs Docker installed |
| Deploy = copy files + pray | Deploy = pull image + start container |

### What containers did not solve

Running containers on one machine is easy. `docker run` and done.

What about ten machines?

- Which machine runs which container?
- Who restarts a container that died?
- How is traffic split across several containers?
- To scale up, on which machine does the new one start?
- How do the old and new versions do a rolling update?

These questions need an orchestrator (a system that schedules containers, restarts them, and distributes traffic to them).

---

## k8s: let machines manage machines

In 2014 Google open sourced Kubernetes. Its predecessor was Borg, the container orchestrator Google had run internally for ten years.

k8s does not build images. It accepts a declaration of state, such as "I want 3 replicas", **then adjusts the actual state to match the declaration, and keeps it that way.**

### Declarative vs imperative

Imperative (what we have been doing so far):

```bash
ssh server-1 "docker run -d --name app -p 8080:8080 my-app:v1.2"
ssh server-2 "docker run -d --name app -p 8080:8080 my-app:v1.2"
ssh server-3 "docker run -d --name app -p 8080:8080 my-app:v1.2"
```

Three servers, run by hand three times. One of them failed? Deal with it yourself.

Declarative (the k8s way):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
      - name: app
        image: my-app:v1.2
        ports:
        - containerPort: 8080
```

The YAML declares "I want 3 replicas". k8s decides for itself which three nodes to run them on. One of them died? k8s creates a new one on another node automatically. Nobody has to step in.

The "3 replicas" written in the YAML is the desired state. What is actually running on the cluster is the actual state. A controller is the program inside k8s that keeps comparing the two and corrects any difference it finds. That action is called reconcile.

### Self-healing

A Pod dies. The k8s controller finds actual replicas = 2, desired replicas = 3. One short, so it creates a new one.

A node dies. Every Pod on it is marked lost. The controller recreates them on other nodes.

The 3am job from the start, SSH in and restart the process, is now handled by the controller.

### Service Discovery: built in

Before, you wrote the Nginx upstream by hand:

```nginx
upstream backend {
    server 10.0.1.5:8080;
    server 10.0.1.6:8080;
    server 10.0.1.7:8080;
}
```

Pod IPs are temporary. A Pod restarts, new IP. Scale up, new IP. Every change means editing this list by hand, and with enough Pods you never finish editing.

A k8s Service is a stable virtual IP (ClusterIP). Pod A calls `my-service:8080`, and kube-proxy routes the traffic to an actual Pod through iptables rules. When Pods come and go, the rules update automatically.

The caller only needs the Service name. How many Pods are behind it, and where they run, is none of its concern.

### Rolling Update

Update to v1.3:

```bash
kubectl set image deployment/my-app app=my-app:v1.3
```

k8s creates new v1.3 Pods in batches, and only kills the old v1.2 Pods after the new ones are confirmed healthy. Zero downtime throughout. If the new Pods keep crashing, the rollout stops and the old version keeps serving.

Before, you wrote the rolling update logic in your own deploy script. Now it is built in.

---

## What k8s solved, and what it cost

### Solved

| Before | After |
|---|---|
| Decide by hand where a container runs | The scheduler assigns it automatically |
| A dead container needs a human to restart it | Self-healing, recreated automatically |
| Maintain the Nginx upstream by hand | Service Discovery built in |
| Write your own rolling update script | Rolling update built in |
| Every server is a snowflake | Nodes are replaceable and stateless |

### The cost

**A lot of YAML.**

One microservice deployed to k8s needs at least six YAML files:

- Deployment: defines the container, replicas and resource limits
- Service: handles internal DNS and load balancing
- ConfigMap: holds config files
- Secret: holds passwords and API keys
- Ingress: manages the entry point for external traffic
- HPA (Horizontal Pod Autoscaler): sets the rules for automatic scaling

Thirty microservices? 180 YAML files.

Three environments, dev, staging and prod? The YAML is almost identical, differing only in image tag, replica count and env vars. Copy and paste three times.

Change the dev ConfigMap, forget the prod one, deploy on Friday, and prod goes down.

180 YAML files edited by hand is the same as SSHing into thirty servers back then. A human doing repetitive work.

### The deeper problem

Who runs `kubectl apply`? An engineer, by hand.

Who confirms the applied YAML matches what is in Git? Nobody.

Someone ran `kubectl edit` and changed the replica count by hand? Git does not know. The actual state on the cluster has drifted from the YAML in the repo.

k8s automated deployment, but the YAML is still written by humans: 180 YAML files, three lines edited by hand for each environment.

---

## How the manual work of writing YAML and running apply was removed later

[Helm](chunk://helm) turns YAML into templates. One template plus one set of parameters produces the YAML for three environments. But a complex template is harder to read than the raw YAML.

[Terraform](chunk://terraform) manages the k8s cluster itself. k8s handles containers; the VPC, subnets, node groups and IAM are infrastructure that is not in k8s YAML. Terraform manages them declaratively.

[GitOps](chunk://gitops) removes the manual `kubectl apply`. ArgoCD watches the Git repo from inside the cluster, and whenever there is a new commit it syncs it to the cluster automatically. So a commit into Git is the deployment.
