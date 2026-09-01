---
title: "來試試看 DDD 全部 apply，會不會超棒？"
slug: ddd-textbook-vs-real
date: 2026-06-14
subtitle: ""
chapter: "extras"
tags: [ddd, architecture, design-patterns, repository-pattern, anti-corruption-layer, hexagonal]
related: [etcd-raft]
---

# 來試試看 DDD 全部 apply，會不會超棒？

你讀完 Eric Evans 那本藍皮書（[chunk://ddd](chunk://ddd)）。Ubiquitous Language、[Bounded Context](chunk://bounded-context)、[Aggregate Root](chunk://aggregate)、[Repository](chunk://repository-pattern)、[Domain Service](chunk://domain-service)、[Application Service](chunk://application-service)、[Domain Event](chunk://domain-event)、[Anti-Corruption Layer](chunk://anti-corruption-layer)。八個概念，每個都對到你以前 code 裡碰過的問題。

第二天你打開一個跑在 production 的訂單後端，準備抄。grep `AggregateRoot`、grep `class.*Aggregate`，零個結果。entity 跟 entity 各自獨立，沒有所謂 root。

這是團隊讀過書、想清楚之後刻意不做的。訂單後端抄了哪幾條、其他的為什麼沒做？

## 它的 layered 架構

```text
app/
├── presentation/   HTTP routes、SSE
├── application/    use case、編排
├── domain/         entity、repository 介面、domain service
└── infrastructure/ DB、外部 API（物流、金流）
```

DDD 書上的 layered 寫法。打開實際 code，有些照抄、有些根本沒做。

## rule 1: Repository（用結構化型別介面）

書上寫：domain 定義 repository 介面，infrastructure 提供實作，domain 不認識 infrastructure。

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

這跟 TypeScript 的型別系統有關：它是**結構化型別（structural typing）**，method 名字跟簽名對得上就算實作，**技術上不寫 `implements` 也相容**（那時 infra 連 domain 介面都不用 import，解耦最徹底）。不過實務上多半還是會寫 `implements`（NestJS 尤其這樣），為了讀起來清楚、也讓 type checker 早點抓到簽名對不上。

結構化型別不是 Go 的專利，TS 一樣，差別只在它們都是編譯期檢查，不像 Python / Ruby 那種執行期的 duck typing。**你習慣的「一定要寫 implements」是 Java / C# 那種 nominal 型別。**

這條大概是照得最完整的一條：domain 定義介面，infrastructure 照著實作，application 只認介面、不管底下是哪家 DB。

## rule 2: Dependency Injection

兩邊互不認識，那靠誰接起來？

不接會怎樣？假設 `PlaceOrderService` 自己 `new` 出 repository：

```typescript
class PlaceOrderService {
  private orderRepo = new PrismaOrderRepository(prisma);  // 寫死在這
}
```

這個 class 就跟 `PrismaOrderRepository` 綁在一起了。要換 Mongo、要在測試裡塞假的，只有一條路：進這個檔改 source。而且它一定得 import Prisma，編譯期就依賴 infrastructure。

DI 做的事，是把這個 `new` 拿掉，改成從 constructor 收進來：

```typescript
class PlaceOrderService {
  constructor(private orderRepo: OrderRepository) {}  // 不自己 new，參數型別是 domain 介面
}
```

`new` 搬去哪其實不重要。這個 class 不再自己決定用哪個 repository，改由外面塞進來。同一個沒改過的 class，prod 跟測試各餵各的：

```typescript
new PlaceOrderService(getOrderRepository(prisma), ...)  // production，實體來自 di.ts
new PlaceOrderService(fakeOrderRepo, ...)               // 測試，塞假的、不連真 DB
```

它依賴的是 `OrderRepository` 介面、碰不到具體 class，所以測試塞得進假的、換 DB 也不用動它。

那 `new` 跑哪去了？集中到一個檔：

```typescript
// di.ts —— 整個 codebase 唯一同時 import domain 跟 infrastructure 的地方
import type { OrderRepository } from '@/domain/repositories/order-repository';
import { PrismaOrderRepository } from '@/infrastructure/prisma-order-repository';

export function getOrderRepository(prisma: PrismaClient): OrderRepository {
  return new PrismaOrderRepository(prisma);   // 回傳型別是 domain 介面，實體是 infra class
}
```

return type 宣告的是 domain 的 `OrderRepository`，回傳的實體卻是 `PrismaOrderRepository`。其他檔案要嘛只待在 domain、要嘛只待在 infrastructure，只有 `di.ts` 跨兩邊。`new` 只活在這裡，換 DB 那天也只改這一行：

```typescript
return new MongoOrderRepository(mongo);   // domain 跟 application 一行不動
```

你可能會想：我平常寫 NestJS 根本很少自己 `new`。對，手刻 `di.ts` 是為了把機制攤開看；實務上 NestJS 的 DI container 幫你做掉這串 `new`，你只在 module 宣告綁定：

```typescript
@Module({
  providers: [
    PlaceOrderService,
    { provide: OrderRepository, useClass: PrismaOrderRepository },  // 換 DB 改這行的 useClass
  ],
})
export class OrderModule {}
```

小坑：`OrderRepository` 是 TS interface，runtime 不存在、不能直接當 token，所以實務上會把它寫成 `abstract class`、或用 string/symbol token 配 `@Inject()`——這也是 NestJS 圈常寫 `abstract class` 的原因。

**DI 不是消滅 `new`，是把它集中到一個地方，好讓其他 code 依賴介面、不依賴實體。**

如果這 repository 永遠只有一種實作、又不寫測試，DI 就只是把 `new` 搬到另一個檔的儀式。

## rule 3: Anti-Corruption Layer（外部物流商的翻譯層）

訂單要接外部物流商查貨態。FedEx API 回的是它自己的格式（欄位縮寫、狀態代碼、奇怪日期）。這些 type 一旦傳進 application，就被 FedEx 鎖死，哪天換 DHL 那裡面的相關內容就要重來一次。

ACL 的解法是寫一個 translator，把 FedEx 的格式翻成你 domain 的 `Shipment`：

```typescript
// infrastructure/shipping/fedex-acl.ts（只有這個檔看得到 FedEx 的格式）
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

domain 永遠收到 `Shipment`，看不到 `FedexTrackResponse`。換物流商（FedEx → DHL）只改這個檔。

**把它簡單想成 adapter 就好**，design pattern 那個 adapter。ACL 常常就是一堆這種 translator 組成的。差別在它的目的是擋住外部概念、保護 domain，不只是把兩個介面兜起來。

## rule 4: Domain Service 跟 Application Service 分清楚

書上分兩種 service：[Domain Service](chunk://domain-service) 是純業務規則、零 I/O；[Application Service](chunk://application-service) 是編排多個東西、有 I/O。

```typescript
// domain/services/shipping-fee-service.ts —— 只算，不碰 DB、不碰網路
export class ShippingFeeService {
  calc(cart: Cart, dest: Address): Money {
    const weight = cart.totalWeight();
    const base   = weight <= 5 ? 60 : 60 + (weight - 5) * 12;
    const remote = dest.isRemoteArea() ? 100 : 0;
    if (cart.subtotal() >= 1000) return Money.zero();   // 滿千免運
    return Money.of(base + remote);
  }
}
```

```typescript
// application/services/place-order-service.ts —— 編排 + I/O，零業務規則
export class PlaceOrderService {
  constructor(
    private cartRepo: CartRepository,        // 全部都是 domain 介面
    private orderRepo: OrderRepository,
    private shippingFee: ShippingFeeService,
    private events: EventBus,
  ) {}

  async execute(cmd: PlaceOrderCommand): Promise<OrderId> {
    const cart  = await this.cartRepo.getById(cmd.cartId);   // 讀（I/O）
    const fee   = this.shippingFee.calc(cart, cmd.dest);     // 算（domain，純）
    const order = Order.create(cart, fee);                   // entity 行為
    await this.orderRepo.save(order);                        // 存（I/O）
    this.events.publish(new OrderPlaced(order.id));          // 發事件
    return order.id;
  }
}
```

我自己也常要想一下才分得清。**運費怎麼算、訂單成不成立這種業務判斷在 domain；把這些步驟接起來、加上讀寫資料庫，在 application**。`PlaceOrderService` 注入的依賴**全是 domain 介面**，沒一個是具體的 Prisma / FedEx class，所以它永遠不知道下面是哪家 DB、哪家物流。

## skip 1: Aggregate Root

Evans 說：aggregate root 是 entity 群組的對外入口，所有對 child 的變更必須經過 root，為的是守住 invariant。

哪些 entity 對該做 aggregate，看**有沒有跨 entity、必須一起守的規則**。對照兩組：

```typescript
// 有 invariant 的一對：Order + LineItem → 該做 aggregate
class Order {
  private items: LineItem[] = [];
  addItem(item: LineItem) {
    if (this.items.length >= 100) throw new Error('order full');      // invariant
    if (this.status === 'paid')   throw new Error('paid order frozen'); // invariant
    this.items.push(item);
  }
  // 外部不能直接動 LineItem，一定走 order.addItem()
}
```

```typescript
// 沒 invariant 的一對：Customer + Address → 不做 aggregate
class Customer { /* 沒有 addresses 欄位，不擁有 address */ }
class Address  { id: string; customerId: string; line1: string; city: string }

interface AddressRepository {
  listByCustomer(customerId: string): Promise<Address[]>;  // 直接操作，不經過 Customer
  save(a: Address): Promise<void>;
}
```

`Order + LineItem` 有「最多 100 筆」「已付款不能改」這種必須一起守的規則，所有改動都走 root，那條規則才不會被破壞，這時做 aggregate 才划算。

`Customer + Address` 沒有這種規則。一個客戶要存幾個地址都行、改一個地址也不影響別的，兩邊沒有綁在一起的規則。硬把 `Customer` 當 root、所有 address 變更都繞過它，只是讓 code 變複雜，沒換到任何好處。所以 address 就自己一個 repository，跟 customer 各自獨立。

書上會說後者「失去 ownership invariant」，但本來就沒有 invariant 可失去。**沒 invariant 不要做 aggregate**，真要加規則時再 refactor 回來。這跟 [Vaughn Vernon 的 Effective Aggregate Design](https://www.dddcommunity.org/library/vernon_2011/) 一致：看的是真的有沒有要一起守的規則，不是看物件之間關聯多深、或包起來方不方便。

## skip 2: 完整的 Ubiquitous Language

藍皮書講的 UL：每個業務概念在 code 裡都有對應命名，業務說 Order，code 叫 `Order`。

entity 級做到了：`Order`、`Customer`、`Cart`、`Shipment`，名字跟業務對齊。但**金流那層沒做 UL**。付款的 code 直接用 Stripe 的詞彙：`PaymentIntent`、`charge`、`capture`，而不是自己 domain 的 `付款`、`收款`。

所以讀 entity 那塊 code 詞彙都對得上，讀到付款就得切換成 Stripe 的那套講法。這也是 trade-off：如果金流也要做 UL，就得包一層自己的 abstraction 把 Stripe 蓋掉，維護負擔加倍。團隊就讓 Stripe 的詞直接出現，但用 ACL 把它關在 infrastructure 層，不讓它漏到 domain。這也不失為一個取捨：少包一層自己的 abstraction、省下維護，代價就是要另外花一份理解 Stripe 講法的心力就是。

## skip 3: Bounded Context

Evans 教：大型系統有多個 subdomain，同一個詞在不同 subdomain 意義不同（Customer 在 Sales 是潛在買家、在 Support 是已購用戶），要切成不同的 [bounded context](chunk://bounded-context)，各自一份 model。

這個訂單後端整個是**一個 bounded context**。`Order`、`Customer`、`Cart` 在這裡只有一種意義，沒有跨 subdomain。這個不做也合理，規模還沒大到需要拆 BC。書上本來也沒強迫：

> when context boundaries cause friction, then introduce explicit contexts

**沒遇到問題，卻帶著「學過了就應該要用上」的心態硬套，那就變成 over-engineering。**

## 對照表：8 條 vs 訂單後端

| DDD 概念 | 教科書 | 訂單後端做得 | 評語 |
|---|---|---|---|
| Ubiquitous Language | 全 codebase 用業務語言 | entity 級 ✅、金流層 ❌ | 看 trade-off |
| Bounded Context | 多 BC 各自 model | 單 BC | 規模合理，N/A |
| Aggregate Root | 守 invariant | Order/LineItem 做、Customer/Address 不做 | 照有無 invariant 決定 |
| Repository Pattern | domain 介面 + infra adapter | 結構化型別介面 + adapter | 該抄 |
| Domain Service | 純業務 function、零 I/O | `ShippingFeeService` | 該抄 |
| Application Service | 編排 domain service + repository | `PlaceOrderService` | 該抄 |
| Domain Event | 業務事件用 event 傳遞 | `OrderPlaced` 等 | 看需求 |
| Anti-Corruption Layer | 跟外部系統的翻譯層 | 物流商 / 金流 translator | 該抄 |

整體：抄了 Repository、Domain/Application Service、ACL；沒做的是 Aggregate（看有沒有 invariant）、金流層的 UL、多 BC。

## 難的不是做，是決定不做哪些

八條全抄是新手做法。每個 pattern 都做滿、能加的 abstraction 全加上去，最後 codebase 一堆不必要的間接層，新人讀起來「為什麼這個 aggregate 只包一個 entity」「為什麼這個 domain event 只有一個 subscriber」，就是 over-engineering。

一開始會想當然全部照做，但實務久了就知道哪些不好用，然後拿掉特定幾條，就像寫 React 久了會說「少用 useEffect」。**這種判斷的手感，是在重複的日常裡慢慢抓到的。**每個不做的決定背後是：

- 「這個 invariant 真的存在嗎？沒有就不做 aggregate」
- 「這個 subdomain 真的會分裂嗎？不會就不拆 BC」
- 「這個 abstraction 真的會被替換嗎？會才做 ACL」

而且 DDD 實務的共識是：strategic 那層（bounded context、ubiquitous language）是地基，要留；最常拿掉的是 tactical 那群，沒好理由就別硬加。

## 寫個 ADR 吧

不做 Aggregate，如果沒寫下為什麼，將來有人想「Customer/Address 這應該做 aggregate 啊」，沒有文件能告訴他「我們討論過，這對沒有 invariant，刻意不做」。沒寫下理由的決策會被推翻，下一個剛讀完 Evans 的人會想當然加回來。

這就是 ADR（Architecture Decision Record）存在的理由，每個刻意的 skip 寫一份：

```text
ADR-007: Customer / Address 不做 Aggregate

Status: accepted

Context:
設計 Customer + Address 時討論過要不要把 Customer 當 Aggregate Root、
Address 當 child。

Decision:
不做。Customer 跟 Address 平等，各自有獨立 Repository。

Decision drivers:
1. 沒有跨兩者、必須一起守的 invariant（地址數量沒上限、改一個不影響別的）
2. 加 aggregate 增加複雜度但換不到保護
3. 未來真要加規則，refactor 回 aggregate 成本可控

Consequences:
- 應用層直接呼叫 AddressRepository，不經過 Customer
- 將來如果要加跨 address 的不變式，要重新評估
```

## 這篇的結論

1. **八條是給你挑的，不是全做**。怎麼組合是架構師的職責，全抄是 over-engineering。
2. **決定不做就要寫 ADR**。沒寫下來的決策會被下一個讀過 Evans 的人推翻。
3. **Repository + ACL 是大多數團隊該抄的兩條**。其他看情況，這兩條對絕大部分系統 ROI 都是正的。

要先搞懂八條在幹嘛，才知道哪些值得留、哪些可以省。沒讀就照抄的，最後常常留了一堆花俏的 aggregate，反而把真正有用的 ACL 跟 Repository 漏掉。
