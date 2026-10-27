---
title: "Anti-Corruption Layer"
slug: anti-corruption-layer
brief: "A translation layer between an external framework and the domain. Swapping the framework changes one file."
article: ddd-textbook-vs-real
date: 2026-06-14
---

# Anti-Corruption Layer

ACL for short (Anti-Corruption Layer; it shares the abbreviation with Access Control List from network permissions and has nothing to do with it). When a codebase has to integrate with an external system (a framework, a third-party API, a legacy DB), the ACL is the **translation** layer in between. It turns the external types, concepts and data structures into the domain's own format.

## Why it is needed

If the domain uses an external system's types directly, every change outside forces a change in the domain:

- The external API bumps a version → the domain changes too
- The external framework is replaced → the whole domain gets rewritten
- Two external systems have conflicting types → the domain bends to both

The ACL keeps external types and status codes at the boundary and out of the domain.

## An example

An e-commerce site connects to an outside carrier to look up shipment status. The FedEx API answers in its own format (abbreviated fields, status codes, odd dates), but the domain only wants a clean `Shipment`:

```typescript
// infrastructure/shipping/fedex-acl.ts (the only file that knows the FedEx format)
import type { FedexTrackResponse } from 'fedex-sdk';
import type { Shipment } from '@/domain/shipment';

const STATUS = { IT: 'in_transit', DL: 'delivered', EX: 'exception' };

export function toShipment(raw: FedexTrackResponse): Shipment {
  return {
    trackingNumber: raw.trk_no,
    status: STATUS[raw.status_cd] ?? 'unknown',
    estimatedDelivery: parseYmd(raw.est_dlv),   // "20260620" → Date
  };
}
```

The domain always receives a `Shipment` and never sees a `FedexTrackResponse`. The day the carrier changes (FedEx → DHL), only this ACL file changes; the domain's `Shipment` does not move a line.

This `toShipment` is in fact an adapter, and an ACL is usually made of a pile of translators like it. An adapter's goal is to let two interfaces call each other. An ACL's goal is to **keep external concepts out of the domain**; the interfaces fitting together is only a side effect.

## Trade-offs

- Maintenance cost: every change to an external type means updating the translator
- The payoff of this layer only arrives the day the framework is swapped

Many teams skip the ACL because using the external types directly is fastest at the start. The price is that the external types show up in every file that uses them, and the day the carrier or framework changes, all of those files change.
