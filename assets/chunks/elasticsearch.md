---
title: "Elasticsearch"
slug: elasticsearch
brief: "把搜尋、過濾、排序、聚合、地理查詢包成一個 query。Lucene index 加 REST API。"
date: 2026-04-28
updated: 2026-09-01
revisions: 1
article: search-geo
---

# Elasticsearch

> Postgres 的 LIKE '%關鍵字%' 在百萬筆以上就慢到不行。為什麼 search 工作要交給專門的 engine？

## 場景

Airbnb search：用戶輸入「Tokyo + 12/20-12/27 + 2 guests + wifi + 預算 50-300」。系統要在 7M 筆 listing 裡：

1. 文字 match（「Tokyo」對到 city 或 description）
2. 地理 filter（在 Tokyo bbox 內）
3. 多個 filter 組合（amenities、price range、room type）
4. 按 relevance + rating 排序
5. 順便算 facets（每個 amenity 有幾筆，給 UI 顯示）

Postgres 一個 query 包不下這些，或者包得下但慢。

## Inverted Index：搜尋的核心

Postgres B-tree 是「給我 id，我給你 row」。Inverted index 反過來：「給我詞，我給你所有出現過的 doc」。

```text
詞       → doc IDs
"tokyo"  → [101, 203, 405, ...]
"loft"   → [101, 502, 703, ...]
"wifi"   → [101, 102, 105, ...]

搜「tokyo loft wifi」
  → 三個 list 取交集 → [101, ...]
```

[Search inverted index](chunk://search-inverted-index) 講原理，ES 是用 Lucene 把這套生產化的 engine。

## 一個 query 同時做多件事

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

Postgres 要這套：FTS extension、PostGIS、多個 GIN/GIST index、加 GROUP BY 算 facets。能做，但 query 複雜、optimizer 不見得選對 plan。ES 一個 request 全包。

## 跟 Postgres 怎麼共存

Source of truth 還是 Postgres。寫入：

```text
Host 改 listing → 寫 Postgres
                ↓
            CDC（Debezium）監聽 WAL
                ↓
            推 Kafka
                ↓
            Consumer 寫 ES
```

[CDC](chunk://cdc) 把寫入事件流出來，ES 當衍生 view。Sync delay 1-3 秒可接受。

**為什麼不雙寫**：app code 同時寫 Postgres + ES，一邊成功一邊失敗就會不一致，要寫補償邏輯。CDC 把一致性問題留給 Kafka 的 retain + replay 解。

## 限制

- **不是 transaction store**：寫入是 near-real-time，refresh 預設 1 秒。寫完馬上讀可能還沒看到。每次 refresh 產生一個新的 Lucene segment，segment 寫完就不再修改，背景再用 [merge](chunk://compaction) 把小 segment 合併掉。跟 [LSM Tree](chunk://lsm-tree) 的 compaction 同一個處境，只准 append 就得有人負責合併。合併的細節不同，term dictionary 那層走 k-way merge，stored fields 在來源沒有刪除時直接複製壓縮後的 chunk。
- **Schema 一旦定型，改 mapping 要 reindex**：欄位 type、analyzer 改了就得重建整個 index。
- **記憶體吃很兇**：field data、cache 都常駐 heap。**容量規劃比 Postgres 講究**。
- **不適合主交易**：Booking、payment 走 Postgres，搜尋走 ES。

## 什麼時候用

- 文字 search 要 relevance score → ES（Postgres FTS 也行但較陽春）
- 地理 + filter + facets 一個 query 包 → ES
- Log analytics（ELK stack）→ ES
- 純 key-value lookup、強 transaction → 不要 ES

---

ES = inverted index + geo + aggregation 一站式 search engine。Source of truth 留在 Postgres，[CDC](chunk://cdc) 把資料推過來，ES 專心做 search workload。
