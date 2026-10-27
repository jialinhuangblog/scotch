---
title: "CI/CD"
slug: ci-cd
brief: "CI builds and tests. CD releases."
date: 2026-03-14
updated: 2026-10-18
revisions: 2
article: gitops-deep
---

# CI/CD

CI builds and runs the tests on every push. CD deploys the artifact that passed to production.

## Continuous Integration

An engineer pushes a commit to a PR branch. The CI server receives Git's webhook, starts a clean machine, and runs in order:

1. Pull code
2. Install dependencies
3. Run tests
4. Build artifact (Docker image, binary)

At step 3, one unit test fails at minute 6. The pipeline stops, a red cross appears on the PR page, and the merge button locks. The bug is seen at the PR stage instead of showing up in production. Once the tests pass and the PR is merged, main gains a new commit with the sha `3f9c2e1`. Whether the merge button makes a merge commit or a squash, this sha on main differs from the one on the PR branch, so CI runs again on this commit on main. This time it goes through step 4, builds the image, tags it with the sha from main, `api:3f9c2e1`, and pushes it to the registry. One image per commit on main, so a rollback later means switching the tag back to the previous sha on main.

## Continuous Delivery vs Continuous Deployment

Once `api:3f9c2e1` is in the registry, the two approaches part ways.

**Delivery** — the artifact is ready, but a person presses the button to deploy. The pipeline waits at "pending approval", and the person on duty checks staging before pressing it.
**Deployment** — the artifact is ready and deploys automatically. Fifteen minutes after the merge into main, `api:3f9c2e1` is already serving traffic in production, and nobody looked at it in between.

Continuous Deployment has no human gate. A bug the tests did not catch goes straight to production, so the tests have to be complete enough before you dare do this.

## Pipeline tools

GitHub Actions, GitLab CI, Jenkins and CircleCI all follow the same flow: listen for a Git event → run a series of steps → produce an artifact.

## Relation to GitOps

Traditional CI/CD: the pipeline's last step runs `kubectl apply` or `helm upgrade` directly, pushing `api:3f9c2e1` onto the cluster.
GitOps split: the CI pipeline only does build + push image, then changes the image tag in the manifest repo from `api:a81d0b7` to `api:3f9c2e1` and commits it. ArgoCD sees the manifest change and only then applies it to the cluster.
