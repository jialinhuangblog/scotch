---
title: "拖曳地圖觸發 refetch，但房源有七百萬筆"
slug: search-geo
subtitle: "Postgres 包不下 search workload。Elasticsearch、geohash、CDC 怎麼分工。"
chapter: "search"
tags: [elasticsearch, geohash, cdc, search]
date: 2026-04-28
related: [search-cache]
---

# 拖曳地圖觸發 refetch，但房源有七百萬筆

Airbnb 的 search 介面看起來簡單：左邊一排 listing，右邊一張地圖，地圖一拖就重查。但下面要同時做：文字 match、地理 filter、多重條件 filter、按 relevance + rating 排序、順手算 facets（每個 amenity 有幾筆）。

Airbnb 規模約 700–800 萬個 listing（[2023 約 700 萬、2024 約 800 萬](https://www.demandsage.com/airbnb-statistics/)）。MAU 跟每秒查詢量官方沒公布，本文假設「上億用戶、每秒數千查詢」的量級來設計。

Postgres 一個 query 包不下這些。能包下也慢：`ILIKE` 在百萬筆掃描就跪，FTS extension 加 PostGIS 加 GIN index 加 GROUP BY 算 facets，optimizer 不見得選對 plan。

這篇講把 search workload 拆給 [Elasticsearch](chunk://elasticsearch)、Postgres、[CDC](chunk://cdc) 各做一份的設計。

---

## 需求分解

```text
搜尋頁
  ├── location: "Tokyo" / bbox / radius
  ├── dates: 12/20-12/27
  ├── guests: 2 adults
  ├── filters: price 50-300, wifi, kitchen, entire_place
  ├── sort: relevance / price / rating / newest
  └── facets: 「wifi 800 筆、pool 230 筆」← UI 顯示這個

  ↓

Result
  ├── 20 個 listings（list + map markers）
  ├── facets count
  └── cursor 給下一頁
```

要快、要對、地圖一拖要立刻重查。每個維度都打架：

- 文字 search → 要 [inverted index](chunk://search-inverted-index)
- 地理範圍 → 要 [geohash](chunk://geohash) / R-tree
- Filter 組合 → 要多個 column 的複合 index
- Ranking → 要 score function
- Facets → 要 group by + count
- Pagination → 量大時 offset 變 O(N)

一個 DB engine 全做的成本太高。**選 ES 主導 search path，Postgres 留 source of truth**。

---

## 為什麼是 Elasticsearch

[ES](chunk://elasticsearch) 一個 query 同時做：

```json
{
  "query": {
    "bool": {
      "must":   [{ "match": { "description": "loft" } }],
      "filter": [
        { "geo_bounding_box": { "location": { ... } } },
        { "range": { "price": { "gte": 50, "lte": 300 } } },
        { "term":  { "amenities": "wifi" } }
      ]
    }
  },
  "sort": [{ "_score": "desc" }, { "rating": "desc" }],
  "aggs": {
    "amenity_counts": { "terms": { "field": "amenities" } },
    "price_histogram": { "histogram": { "field": "price", "interval": 50 } }
  }
}
```

文字 match + geo + range + term filter + sort + facets 一次 round-trip 全包。Postgres 能做但要拼三個 extension，query plan 複雜，每多一個 filter 都得擔心 index 選錯。

**ES 不適合的地方**：transaction、強一致、按 PK lookup。Booking、payment 這些絕對不能搬到 ES。

```text
寫入路徑：app → Postgres（source of truth）
  ↓
  CDC → Kafka → ES consumer → Elasticsearch（衍生 view）

讀取路徑：
  Search → ES
  Booking detail → Postgres
  Listing detail（搜尋結果 click 進來）→ Postgres + Redis cache
```

Postgres 是真相，ES 是衍生 view。一致性靠 [CDC](chunk://cdc) 維持。

---

## Geo Search 的三種 query mode

| Mode | 場景 | 怎麼查 |
|---|---|---|
| **Bounding box** | 地圖 viewport 拉動 | 給左下右上兩個座標，取框內所有 |
| **Radius from point** | 「巴黎中心 5km 內」 | 給中心 + 半徑 |
| **Polygon** | 「Brooklyn 區域」 | 給多邊形邊界（實作上少見） |

ES 的 `geo_point` 欄位內部用 [geohash](chunk://geohash) 索引，三種 mode 都能跑。Postgres 要 PostGIS 才有等價能力。

### Marker Cluster（zoom out 時）

地圖縮到全國 view，一個 viewport 框內 100,000 個點，前端畫不下 markers。三條路：

1. **Server 端 geohash aggregation**：ES 的 `geohash_grid` agg 按 zoom level 對應的 precision 聚合，回傳 cluster 中心 + count
2. **前端 supercluster.js**：server 回 raw points，前端 cluster。資料量大時前端會卡
3. **預先 tile-based aggregation**：離線把 listing 預聚合成 tile，前端按 zoom 查對應 tile。最快但 build pipeline 重

實務上 (1) 預設、(3) 給 popular 城市做加速。

---

## Availability：時間維度的 filter

`dates` filter 麻煩，因為：

- 每個 listing 有 calendar（已 booked dates）
- Search 要過濾「這個 date range 沒被 book」
- Calendar 變動頻繁（每筆 booking 觸發），不適合 ES（會 index churn）

兩種解：

**A. ES 存 `availability_bitmap` 或 `blocked_until`**
容忍幾秒 sync delay。Booking 完到 ES 更新中間有 race window，使用者可能看到「可預訂」但點進去 unavailable。**UX 補：detail 頁再驗一次**。

**B. Two-phase search**
ES 取 candidate（忽略 availability），拿 ID 列表去 Redis / availability service batch 查可用性，過濾後回傳。**多一個 round trip 但資料新鮮**。

Airbnb 實際偏 (A) + UX fallback：(A) 當預設，需要更高新鮮度才上 (B)。

---

## Ranking：兩段式

純距離 + price 是最爛排序。實際的 ranking 是 two-stage：

### Stage 1: Retrieval（粗排）

ES 用基本 score（geo + filter + simple boost）拉 top 1000 candidates。快、便宜、能水平 scale。

### Stage 2: Re-ranking（精排）

ML model 對 1000 個 candidates 重新打分。Features：

- **Listing quality**：rating_avg, review_count, response_rate, host_superhost
- **User personalization**：歷史 click / book / wishlist pattern
- **Price competitiveness**：vs 附近同等級 listing
- **Diversity**：不要全部同房型 / 同價位 / 同 host
- **Recency**：新 listing 的 cold start boost

模型：gradient boosted tree（XGBoost / LightGBM）或 small DNN。Training data：booking outcomes（positive = booked, negative = clicked but not booked）。

Online tuning：A/B test 不同參數、user click feedback 即時 reweight。

一句話總結：relevance score 包含 geo + quality + personalization，底層是 ML 的 two-stage（粗排 + 精排）。

---

## Schema 拆分

### Postgres（source of truth）

```sql
CREATE TABLE listings (
  id UUID PRIMARY KEY,
  host_id UUID NOT NULL,
  title TEXT,
  description TEXT,
  location GEOGRAPHY(POINT, 4326),
  city_id UUID,
  bedrooms INT,
  price_per_night NUMERIC(10, 2),
  amenities TEXT[],
  room_type TEXT,
  rating_avg NUMERIC(3, 2),
  review_count INT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX listings_location_gix ON listings USING GIST (location);
CREATE INDEX listings_city_id_idx ON listings (city_id);

CREATE TABLE bookings (
  id UUID PRIMARY KEY,
  listing_id UUID REFERENCES listings(id),
  guest_id UUID,
  check_in DATE,
  check_out DATE,
  status TEXT
);
CREATE INDEX bookings_listing_dates_idx ON bookings (listing_id, check_in, check_out);
```

### Elasticsearch index

```json
{
  "mappings": {
    "properties": {
      "id":             { "type": "keyword" },
      "title":          { "type": "text" },
      "location":       { "type": "geo_point" },
      "price_per_night":{ "type": "float" },
      "bedrooms":       { "type": "integer" },
      "amenities":      { "type": "keyword" },
      "room_type":      { "type": "keyword" },
      "rating_avg":     { "type": "float" },
      "review_count":   { "type": "integer" },
      "host_superhost": { "type": "boolean" },
      "blocked_until":  { "type": "date" }
    }
  }
}
```

### Sync 策略

```text
Postgres ── WAL ── Debezium ── Kafka topic ── ES consumer ── Elasticsearch
                                          │
                                          ├── Cache invalidator → Redis
                                          └── Analytics → ClickHouse
```

[CDC](chunk://cdc) 把單一寫入廣播給多個下游。Sync delay 1-3 秒可接受。失敗時 Kafka retain，手動 replay。

---

## API 設計重點

```ts
POST /api/v1/search
{
  "location": { "type": "bbox", "coords": [...] }
              | { "type": "place_id", "id": "ChIJ..." }
              | { "type": "radius", "center": [...], "km": 5 },
  "dates": { "check_in": "2026-12-20", "check_out": "2026-12-27" },
  "guests": { "adults": 2 },
  "filters": { "price_min": 50, "price_max": 300, "amenities": ["wifi"] },
  "sort": "relevance",
  "pagination": { "cursor": "...", "limit": 20 }
}
```

幾個關鍵設計：

- **`location` 一個欄位三種 mode**（bbox / place_id / radius）：前端按 UI state 決定
- **`facets` 跟 search 一起回**，沒有就灰掉（不要讓 user 選了結果是 0）
- **`cursor` 而不是 `offset`**：deep pagination 用 offset 在 ES 是 O(N) 災難，cursor 是 O(1)
- **`total_count_estimate`** 不保證精準。大結果集精準算 count 慢，給估值即可

---

## 特殊情況

| 場景 | 處理 |
|---|---|
| 「Paris」搜尋歧義 | Autocomplete 預先 disambiguate，給 place_id 不給字串 |
| 跨年 dates（12/30 → 1/3） | 日期解析要正確，不要按 year 切兩段 |
| 0 results | Fallback 給附近區域 / 放寬 dates / 移除最嚴 filter |
| 極端 zoom out | Cluster aggregation |
| 剛被 book 但 ES 還沒 sync | Detail 頁再驗一次，提供 alternative listings |
| Host 取消 listing | CDC 通知 ES 刪除，搜尋立刻消失 |
| Mobile vs desktop | Mobile 沒空間並排，改 toggle 模式 |
| Bot 大量打 search | [Rate limit](chunk://rate-limiter) per IP / per session |

---

## 決策場景

你是 SaaS 旅館訂房新創的後端 lead。MVP 只有 5,000 listing，全部靠 Postgres + PostGIS 跑。月 GMV 開始破百萬，listing 衝到 80,000，產品要加 amenity filter + autocomplete + map cluster。

第一個壓力點：amenity filter。listing.amenities 是 array，Postgres 用 GIN index 查 `array @> ['wifi','kitchen']`，加上 price range、bbox、city_id 四五個 filter 一起，query plan 開始選錯 index。10 秒以上的 query 出現。

第二個壓力點：facets。每次 search 都要 GROUP BY amenity 算 count。80,000 筆還行，預期年底破 50 萬筆會更慘。

決策：引入 [Elasticsearch](chunk://elasticsearch)。Postgres 留 source of truth，[Debezium](chunk://cdc) 讀 WAL 推 Kafka，consumer 寫 ES。Search workload 全走 ES。Booking、payment、host CRUD 不動。

兩個月做完，p95 search latency 從 3.5s 降到 80ms。Facets 從 「另開一個 endpoint 算」變成「跟 search 同一個 query 回」。

### Regret condition

ES 是衍生 view，consistency 是 eventual。某天客服收到投訴：「我下架了 listing，搜尋還看得到」。Sync delay 在 ES 重啟、Kafka lag、consumer 卡住時可能拉到分鐘級。要做的：

1. ES delete 改成 soft delete + 標記 `hidden`，搜尋濾掉這個 flag
2. 監控 Kafka consumer lag，超過 30 秒 alert
3. Detail 頁進去再驗一次（雙重檢查）

如果業務變成「listing 下架要立刻消失，不能容忍 5 秒 delay」，就要把 search 流量導回 Postgres 的某條 path（例如 city_id + 簡單 filter），ES 只跑複雜 query。

---

## 來源

- Airbnb active listings：2023 約 700 萬、2024 約 800 萬，[demandsage Airbnb Statistics](https://www.demandsage.com/airbnb-statistics/)（彙整 Airbnb 官方財報數字）。MAU 與每秒查詢量 Airbnb 未公開，本文相關量級為假設。
