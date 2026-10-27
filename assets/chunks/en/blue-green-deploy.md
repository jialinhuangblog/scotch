---
title: "Blue-Green Deployment"
slug: blue-green-deploy
brief: "Two full environments. Traffic switches to the new version all at once, and rollback is switching back to the old one."
date: 2026-04-02
updated: 2026-10-18
revisions: 2
article: progressive-delivery
---

# Blue-Green Deployment

Run two full environments at the same time. Blue is the current production, Green is the new version.

## Flow

```
Blue (v1) ← 100% traffic
Green (v2) ← 0% traffic, deploying

Deploy done, smoke test passed:
Blue (v1) ← 0%
Green (v2) ← 100% traffic    ← switch

Something broke:
Blue (v1) ← 100% traffic     ← rollback
Green (v2) ← 0%
```

The switch moves the whole environment at once, not Pod by Pod, so it completes instantly. The old environment is still there, so rollback is just as fast.

## The price

Resource cost doubles, because both environments run during the deployment. If prod runs 20 Pods, a blue-green deployment runs 40 for its duration.

The hardest part is database migration, because Blue and Green share one DB. v2 wants to split the `name` column of the users table into `first_name` and `last_name`. If the migration drops `name` outright, and ten minutes after Green goes live a bug forces a switch back to Blue, v1's code still runs `SELECT name` on a column that no longer exists, and the rollback becomes a second outage. So the schema change is done in two steps. The first migration only adds `first_name` and `last_name`, splits `name` into them for every existing row (a backfill), and keeps `name`. v2 writes all three columns. When it reads, it reads `first_name` first, and if that is null it reads `name` and splits it itself. The nulls exist because Blue still serves traffic until the switch, so users that v1 writes in that window only have `name`, and every switch back to Blue and forward again adds another batch. The second step comes once nobody will switch back to v1: run the backfill again to fill those rows, and only then does the next version drop `name`.

## Difference from Canary

Canary releases traffic gradually, so the risk is spread over a period of time. It suits cases where you want to verify slowly with metrics. Blue-green swaps everything at once, so the risk is concentrated in the moment of the switch. The benefit is that rollback is also a single switch.
