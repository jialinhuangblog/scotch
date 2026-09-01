---
title: "Anti-Corruption Layer"
slug: anti-corruption-layer
brief: "外部 framework 跟你 domain 之間的翻譯層。換 framework 改一個檔。"
article: ddd-textbook-vs-real
date: 2026-06-14
---

# Anti-Corruption Layer

簡稱 ACL（Anti-Corruption Layer，跟網路權限那個 Access Control List 只是縮寫撞名，完全無關）。當你的 codebase 必須跟外部系統（framework / 第三方 API / legacy DB）整合，ACL 是中間那層**翻譯**，把外部的 type、概念、資料結構翻譯成你 domain 自己的形狀。

## 為什麼需要

外部系統的 type 一旦滲進你 domain，你被綁住：

- 外部 API 升版 → 你 domain 也要改
- 外部 framework 換掉 → 你 domain 整套要重寫
- 兩個外部系統 type 衝突 → 你 domain 兩邊都要遷就

ACL 負責在邊界把外部的髒東西擋掉。

## 一個範例

電商要接外部物流商查貨態。FedEx API 回的是它自己的格式（欄位縮寫、狀態代碼、奇怪日期），但你 domain 只想要一個乾淨的 `Shipment`：

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

domain 永遠收到 `Shipment`，看不到 `FedexTrackResponse`。哪天換物流商（FedEx → DHL），只改這個 ACL 檔，domain 的 `Shipment` 一行不動。

做法上，這個 `toShipment` 本質就是個 adapter／轉換器；ACL 常常就是一堆這種 translator 組成的。差別在**目的**：adapter 是把兩個接口兜起來，ACL 是「**擋住外部概念、保護 domain**」，兜接口只是順便。

## 取捨

- 維護成本：每個外部 type 變動都要更新 translator
- 換 framework 那一天，整個工程的回報才出現

很多團隊不寫 ACL，因為一開始外部 type 直接拿來用最快。代價是它會滲進每個用到的地方，哪天那個物流商、那個 framework 要換，當初散到哪就得改到哪。
