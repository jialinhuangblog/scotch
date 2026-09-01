---
title: "Geohash & Geo Search"
slug: geohash
brief: "把經緯度編成字串，prefix 越長範圍越小。地理範圍查詢的索引法。"
date: 2026-04-28
article: search-geo
---

# Geohash & Geo Search

> 「找 5 公里內的餐廳」這個 query，DB 不能只看經緯度兩個 float 兩兩比較。怎麼把地理位置變成可索引的東西？

## 問題：經緯度沒辦法直接 index

```sql
-- 找方圓 5km 內的點
SELECT * FROM places
WHERE distance(location, my_location) < 5;
```

`distance()` 對每筆 row 都要算一次。10M 筆 row 全表掃描，慢。

B-tree index 索引單一欄位的順序，但「經緯度兩維」沒有自然順序。

## Geohash：把二維壓成一維

把地圖切成網格，每格給一個字串編碼。**Prefix 越長，網格越小**：

```text
ezz...  → 一個大區（中歐）
ezzqq.. → 巴黎周邊
ezzqq3z → 巴黎某個街區（5m × 5m）
```

每多一個字元，範圍縮小 32 倍。**同一格的點 prefix 相同**：

```text
艾菲爾鐵塔附近的餐廳：u09tunq...
凱旋門附近的餐廳：    u09twh4...
共同 prefix：u09t → 在同一個區裡
```

Prefix 變成可以 B-tree index 的字串。「巴黎附近」變成 `WHERE geohash LIKE 'u09t%'`。

## 三種 geo query

| Query | 怎麼做 |
|---|---|
| **Bounding box**（地圖 viewport） | 給左下右上兩個座標，取框內所有點 |
| **Radius**（5km 內） | 算 5km 對應的 geohash precision，比對相關 cells |
| **Polygon**（行政區邊界） | 點是否在多邊形內，要 PostGIS 這類 GIS engine |

## 邊界問題

Geohash 把地球切方格，**邊界兩側點的 prefix 完全不同**，但物理上很近：

```text
(網格邊界)
  ezzpb... | ezzpc...
        ↓
   兩個點實際距離 50m，但 prefix 第一個字就不同
```

解法：查的時候**取目標點 + 周圍 8 格 = 9 格的 prefix**，全部撈出來，再用實際距離過濾。Redis 的 GEOSEARCH、ES 的 geo_distance 內部都這樣做。

## 實作選擇

| 工具 | 適合 |
|---|---|
| **PostGIS**（Postgres 擴充） | 純 SQL 環境，要做 polygon 計算、行政區邊界 |
| **Elasticsearch geo_point** | 跟 [search](chunk://elasticsearch) workload 整合（filter + ranking + facets 一起做） |
| **Redis GEOADD / GEOSEARCH** | 純 geo 查詢、低 latency、量不大、不需要複雜 filter |
| **MongoDB 2dsphere** | document store 環境，順手 |

選擇看的是「geo 查詢佔系統什麼角色」：主要 search workload 用 ES，輔助查詢用 Redis 或 PostGIS。

## Marker Cluster

地圖縮到全國 view，一個 viewport 有 100,000 個點，前端畫不下。Geohash 順手：按 zoom level 對應的 precision 聚合，**每格回一個 cluster 中心 + count**：

```text
zoom 5  → geohash precision 3 → 全國 ~50 cluster
zoom 10 → geohash precision 5 → 一個城市 ~30 cluster
zoom 15 → geohash precision 7 → 顯示個別 marker
```

ES 的 `geohash_grid` aggregation 直接做這件事。

---

Geohash 把二維地理位置編成可 prefix 比對的字串。這樣一來，查「附近」就是 `LIKE 'xxxx%'`，地圖 viewport 是一段 prefix range，畫 cluster 就是 group by prefix。
