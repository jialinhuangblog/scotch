---
title: "Anti-Corruption Layer"
slug: anti-corruption-layer
brief: "外部 framework 跟 domain 之間的翻譯層。換 framework 只改一個檔。"
article: ddd-textbook-vs-real
date: 2026-06-14
---

# Anti-Corruption Layer

簡稱 ACL（Anti-Corruption Layer，跟網路權限那個 Access Control List 只是縮寫撞名，完全無關）。codebase 必須跟外部系統（framework / 第三方 API / legacy DB）整合時，ACL 是中間那層**翻譯**，把外部的 type、概念、資料結構翻成 domain 自己的格式。

## 為什麼需要

domain 裡要是直接用外部系統的 type，外部一改，domain 就得跟著改：

- 外部 API 升版 → domain 也要改
- 外部 framework 換掉 → domain 整套要重寫
- 兩個外部系統 type 衝突 → domain 兩邊都要遷就

ACL 把外部的 type 跟狀態碼留在邊界，不讓它們進到 domain。

## 一個範例

電商要接外部物流商查貨態。FedEx API 回的是它自己的格式（欄位縮寫、狀態代碼、奇怪日期），但 domain 只想要一個乾淨的 `Shipment`：

```typescript
// infrastructure/shipping/fedex-acl.ts（只有這個檔認得 FedEx 的格式）
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

這個 `toShipment` 其實就是一個 adapter，ACL 通常由一堆這種 translator 組成。adapter 的目的是讓兩個 interface 能互相呼叫；ACL 的目的是**不讓外部概念進到 domain**，interface 接得上只是附帶的結果。

## 取捨

- 維護成本：每個外部 type 變動都要更新 translator
- 這層的好處要到換 framework 那天才用得到

很多團隊不寫 ACL，因為一開始外部 type 直接拿來用最快。代價是外部 type 會出現在每個用到它的檔案裡，哪天要換物流商或 framework，這些檔案全部都要改。
