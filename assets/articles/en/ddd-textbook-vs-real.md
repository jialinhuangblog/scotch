---
title: "What if we apply all of DDD? Wouldn't that be great?"
slug: ddd-textbook-vs-real
date: 2026-06-14
updated: 2026-10-17
revisions: 1
subtitle: "An order backend running in production. It followed Repository, Domain Service, Application Service and Anti-Corruption Layer. Aggregate Root only on Order, where an invariant has to hold; one Bounded Context, because no subdomain is about to split."
chapter: "extras"
tags: [ddd, architecture, design-patterns, repository-pattern, anti-corruption-layer, hexagonal]
related: [etcd-raft]
---

# What if we apply all of DDD? Wouldn't that be great?

You finish Eric Evans's blue book on [DDD](chunk://ddd). Inside are Ubiquitous Language, [Bounded Context](chunk://bounded-context), [Aggregate Root](chunk://aggregate), [Repository](chunk://repository-pattern), [Domain Service](chunk://domain-service), [Application Service](chunk://application-service), [Domain Event](chunk://domain-event) and [Anti-Corruption Layer](chunk://anti-corruption-layer). Eight concepts, and each one matches a problem you have met in code before.

The next day you open an order backend running in production, ready to copy the book. grep `AggregateRoot`, grep `class.*Aggregate`: zero results. Every entity stands on its own. There is no root.

The team read the book, thought it through, and chose not to. Which rules did the order backend copy, and why not the others?

## Its layered architecture

```text
app/
├── presentation/   HTTP routes, SSE
├── application/    use cases, orchestration
├── domain/         entities, repository interfaces, domain services
└── infrastructure/ DB, external APIs (shipping, payment)
```

The directories follow the layered split from the DDD book, four layers.

## rule 1: Repository (with a structurally typed interface)

The book says: the domain defines the repository interface, infrastructure provides the implementation, and the domain never knows about infrastructure.

```typescript
// domain/repositories/order-repository.ts
export interface OrderRepository {
  getById(id: string): Promise<Order | null>;
  save(o: Order): Promise<void>;
}
```

```typescript
// infrastructure/prisma-order-repository.ts
import type { OrderRepository } from '@/domain/repositories/order-repository';
import { Order } from '@/domain/entities/order';

export class PrismaOrderRepository implements OrderRepository {
  constructor(private prisma: PrismaClient) {}

  async getById(id: string): Promise<Order | null> {
    const row = await this.prisma.order.findUnique({ where: { id }, include: { items: true } });
    return row ? OrderMapper.toDomain(row) : null;
  }
  async save(o: Order): Promise<void> {
    await this.prisma.order.update({ where: { id: o.id }, data: OrderMapper.toRow(o) });
  }
}
```

TypeScript uses **structural typing**: if the method names and signatures match, it counts as an implementation. **Technically it is compatible without writing `implements`** (then infra does not even import the domain interface, which is the most complete decoupling). In practice most people still write `implements` (NestJS especially), so the code reads clearly and the type checker reports early when the class signature drifts from the interface.

Structural typing is not only Go's. TS has it too. Both check at compile time, which differs from the runtime duck typing of Python / Ruby. **"You must write implements" is a rule of nominal typing, the Java / C# kind.**

This is probably the rule copied most completely. The domain defines the interface, infrastructure implements it, and application only knows the interface, never which DB sits underneath.

## rule 2: Dependency Injection

(Not one of Evans's eight concepts, but the Repository interface in rule 1 does not work without it, so it counts here.)

The two sides never know each other. So who connects them?

What happens without a connector? Suppose `PlaceOrderService` creates the repository with `new` by itself:

```typescript
class PlaceOrderService {
  private orderRepo = new PrismaOrderRepository(prisma);  // hardcoded here
}
```

This class depends on `PrismaOrderRepository` at compile time, and it must import Prisma. To switch to Mongo, or to put a fake in for tests, the only way is to open this file and change the source.

DI removes that `new` and takes the repository in through the constructor:

```typescript
class PlaceOrderService {
  constructor(private orderRepo: OrderRepository) {}  // no new here; the parameter type is the domain interface
}
```

Where the `new` moved to does not matter much. The class no longer decides which repository to use. The caller passes one in. The same unchanged class gets a different implementation in prod and in tests:

```typescript
new PlaceOrderService(getOrderRepository(prisma), ...)  // production, the instance comes from di.ts
new PlaceOrderService(fakeOrderRepo, ...)               // test, a fake that never touches the real DB
```

It depends on the `OrderRepository` interface and never touches the concrete class, so tests can pass in a fake, and a DB switch leaves it untouched.

So where did the `new` go? Into one file:

```typescript
// di.ts: the only place in the codebase that imports both domain and infrastructure
import type { OrderRepository } from '@/domain/repositories/order-repository';
import { PrismaOrderRepository } from '@/infrastructure/prisma-order-repository';

export function getOrderRepository(prisma: PrismaClient): OrderRepository {
  return new PrismaOrderRepository(prisma);   // the return type is the domain interface, the instance is the infra class
}
```

Every other file stays either in domain or in infrastructure. Only `di.ts` crosses both. `new` appears only here, and on the day the DB changes, only this line changes:

```typescript
return new MongoOrderRepository(mongo);   // domain and application do not change a single line
```

Day to day NestJS code rarely calls `new` by hand. The handwritten `di.ts` is here to lay the mechanism out in the open. In practice the NestJS DI container runs this chain of `new`; you only declare the binding in the module:

```typescript
@Module({
  providers: [
    PlaceOrderService,
    { provide: OrderRepository, useClass: PrismaOrderRepository },  // to switch DB, change the useClass on this line
  ],
})
export class OrderModule {}
```

`OrderRepository` is a TS interface. It does not exist at runtime, so it cannot be a token directly. In practice it is written as an `abstract class`, or as a string/symbol token with `@Inject()`. That is why the NestJS community so often writes `abstract class`.

**DI collects `new` into one place, so the rest of the code depends on interfaces, not on instances.**

If this repository will only ever have one implementation, and there are no tests, the extra layer DI adds has no use: there is no second implementation to swap in, and no test that needs a fake.

## rule 3: Anti-Corruption Layer (a translation layer for the external carrier)

Orders have to query an external carrier for shipment status. The FedEx API answers in its own format (abbreviated field names, status codes, dates as strings like `20260620`). Once these types reach application, application has to understand FedEx's format, and the day you switch to DHL, every piece of code that reads those fields changes.

The ACL fix is a translator that turns FedEx's format into the domain's `Shipment`:

```typescript
// infrastructure/shipping/fedex-acl.ts (the only file that knows FedEx's format)
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

The domain always receives `Shipment` and never sees `FedexTrackResponse`. Switching carrier (FedEx → DHL) changes this file only.

**Think of it simply as an adapter**, the adapter from design patterns. An ACL is often just a pile of these translators. A plain adapter only connects two interfaces; an ACL also keeps the external field names and concepts out of the domain.

## rule 4: Keep Domain Service and Application Service apart

The book splits services in two: a [Domain Service](chunk://domain-service) is pure business rules with zero I/O; an [Application Service](chunk://application-service) orchestrates several steps and has I/O.

```typescript
// domain/services/shipping-fee-service.ts: only calculates, no DB, no network
export class ShippingFeeService {
  calc(cart: Cart, dest: Address): Money {
    const weight = cart.totalWeight();
    const base   = weight <= 5 ? 60 : 60 + (weight - 5) * 12;
    const remote = dest.isRemoteArea() ? 100 : 0;
    if (cart.subtotal() >= 1000) return Money.zero();   // free shipping over 1000
    return Money.of(base + remote);
  }
}
```

```typescript
// application/services/place-order-service.ts: orchestration + I/O, zero business rules
export class PlaceOrderService {
  constructor(
    private cartRepo: CartRepository,        // all domain interfaces
    private orderRepo: OrderRepository,
    private shippingFee: ShippingFeeService,
    private events: EventBus,
  ) {}

  async execute(cmd: PlaceOrderCommand): Promise<OrderId> {
    const cart  = await this.cartRepo.getById(cmd.cartId);   // read (I/O)
    const fee   = this.shippingFee.calc(cart, cmd.dest);     // calculate (domain, pure)
    const order = Order.create(cart, fee);                   // entity behavior
    await this.orderRepo.save(order);                        // save (I/O)
    this.events.publish(new OrderPlaced(order.id));          // publish event
    return order.id;
  }
}
```

**Business judgments like how to compute the shipping fee or whether the order is valid live in the domain. Wiring those steps together and adding the database reads and writes lives in application.** The dependencies injected into `PlaceOrderService` are **all domain interfaces**, not one concrete Prisma / FedEx class, so it never knows which DB or which carrier sits underneath.

## skip 1: Aggregate Root

Evans says: the aggregate root is the single entry point to a group of entities. Every change to a child must go through the root, to protect the invariant.

Compare two pairs of entities:

```typescript
// a pair with an invariant: Order + LineItem → make an aggregate
class Order {
  private items: LineItem[] = [];
  addItem(item: LineItem) {
    if (this.items.length >= 100) throw new Error('order full');      // invariant
    if (this.status === 'paid')   throw new Error('paid order frozen'); // invariant
    this.items.push(item);
  }
  // outsiders cannot touch LineItem directly; always through order.addItem()
}
```

```typescript
// a pair with no invariant: Customer + Address → no aggregate
class Customer { /* no addresses field; does not own addresses */ }
class Address  { id: string; customerId: string; line1: string; city: string }

interface AddressRepository {
  listByCustomer(customerId: string): Promise<Address[]>;  // operated on directly, not through Customer
  save(a: Address): Promise<void>;
}
```

`Order + LineItem` has rules that must hold together: "at most 100 items", "a paid order cannot change". Only when every change goes through the root does the rule stay unbroken, and that is when an aggregate pays off.

`Customer + Address` has no such rule. A customer can store any number of addresses, and changing one does not affect the others. Nothing binds the two sides together. Forcing `Customer` to be the root, with every address change passing through it, only makes the code more complex and protects no extra rule. So address gets its own repository, independent of customer.

The book would say the latter "loses the ownership invariant", but there was no invariant to lose. This agrees with [Vaughn Vernon's Effective Aggregate Design](https://www.dddcommunity.org/library/vernon_2011/): the question is whether there really is a rule to protect together, not how deeply the objects relate or how convenient it is to wrap them.

## skip 2: Full Ubiquitous Language

The UL in the blue book: every business concept has a matching name in code. The business says Order, the code says `Order`.

At the entity level it is done: `Order`, `Customer`, `Cart`, `Shipment`, names aligned with the business. But **the payment layer has no UL**. The payment code uses Stripe's vocabulary directly: `PaymentIntent`, `charge`, `capture`, instead of the domain's own words in the team's language, `付款` (make a payment) and `收款` (collect a payment).

So reading the entity code, the vocabulary matches how the business talks; reading the payment code, you switch to Stripe's way of talking. This is a deliberate trade-off: UL for payment too would mean wrapping an abstraction of your own and replacing all of Stripe's words, which doubles the maintenance load. The team let Stripe's words appear, but used the ACL to confine them to the infrastructure layer, out of the domain.

## skip 3: Bounded Context

Evans teaches: a large system has several subdomains, and the same word means different things in different subdomains (a Customer in Sales is a prospective buyer, in Support a user who already bought). Split them into separate [bounded contexts](chunk://bounded-context), each with its own model.

This order backend is **one bounded context** in full. `Order`, `Customer`, `Cart` have only one meaning here, with no crossing of subdomains. Skipping this is reasonable too, because the scale is not yet large enough to need several bounded contexts. The book never forced it either:

> when context boundaries cause friction, then introduce explicit contexts

## Side by side: the 8 rules vs the order backend

| DDD concept | Textbook | What the order backend does | Comment |
|---|---|---|---|
| Ubiquitous Language | business language across the whole codebase | at the entity level yes, in the payment layer no | the payment layer keeps Stripe's words; wrapping a renaming layer of your own costs too much to maintain |
| Bounded Context | several BCs, each with its own model | one BC | the scale makes sense, N/A |
| Aggregate Root | protect invariants | Order/LineItem yes, Customer/Address no | decided by whether an invariant exists |
| Repository Pattern | domain interface + infra adapter | structurally typed interface + adapter | copy it |
| Domain Service | pure business function, zero I/O | `ShippingFeeService` | copy it |
| Application Service | orchestrates domain services + repositories | `PlaceOrderService` | copy it |
| Domain Event | business events carried as events | `OrderPlaced` and others | publish an event only when several downstreams listen; with one, call it directly |
| Anti-Corruption Layer | translation layer toward external systems | carrier / payment translators | copy it |

Overall: copied Repository, Domain/Application Service and ACL. Skipped Aggregate (by whether there is an invariant), UL in the payment layer, and multiple BCs.

## Deciding what not to do

Copying all eight is the beginner's way. Every pattern done in full, every abstraction that could be added added, and the codebase ends up with piles of unnecessary indirection. A newcomer reads it and asks "why does this aggregate wrap only one entity", "why does this domain event have only one subscriber". That is over-engineering.

At first the instinct is to follow everything. After enough practice you learn which ones do not work well and drop specific rules, the way people who have written React for a while say "use less useEffect". Behind every decision not to do something there is a question:

- "Does this invariant really exist? If not, no aggregate"
- "Will this subdomain really split? If not, no separate BC"
- "Will this abstraction really be replaced? Only then an ACL"

The consensus in DDD practice: keep strategic design (bounded context and ubiquitous language, which decide the model's boundaries and vocabulary). What gets dropped most often is tactical design (aggregate, domain event, the code level patterns).

## Write an ADR

Skip Aggregate without writing down why, and later someone thinks "Customer/Address should be an aggregate". No document can tell them "we discussed this, the pair has no invariant, skipped on purpose", so the next person fresh from Evans adds the aggregate back.

That is why the ADR (Architecture Decision Record) exists. One for every deliberate skip:

```text
ADR-007: No Aggregate for Customer / Address

Status: accepted

Context:
While designing Customer + Address we discussed making Customer the Aggregate Root
and Address its child.

Decision:
No. Customer and Address are equals, each with its own Repository.

Decision drivers:
1. No invariant spans the two that must hold together (no cap on the number of addresses; changing one does not affect the others)
2. Adding an aggregate adds complexity but buys no protection
3. If a rule is really needed later, refactoring back to an aggregate is affordable

Consequences:
- The application layer calls AddressRepository directly, not through Customer
- If an invariant across addresses is added later, re-evaluate
```
