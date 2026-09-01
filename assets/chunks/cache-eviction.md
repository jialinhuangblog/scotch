---
title: "Cache Eviction"
slug: cache-eviction
brief: "LRU、LFU、TTL。記憶體有限，誰該被踢掉？"
date: 2026-06-12
---

# Cache Eviction

> cache 滿了，新資料要進來，該踢掉哪一筆？

## 挑誰丟，決定命中率

cache 放在記憶體、空間有限，滿了就得挑一筆丟掉。挑誰，就是 eviction policy，直接影響命中率。常見幾種：

- **LRU（Least Recently Used）**：丟掉最久沒被碰的。賭「最近用過的等下還會用」（時間區域性），最常用。
- **LFU（Least Frequently Used）**：丟掉用最少次的。賭「熱門的會一直熱門」，但對突然爆紅的新 key 反應慢。
- **TTL / 過期**：每筆設一個存活時間，到期自動清，不管滿不滿。
- **FIFO / random**：先進先出、或隨機丟，簡單但不看冷熱。

像一個小冰箱：塞不下時，先丟最久沒動過的那盒（LRU）。

## 沒有萬用解

LRU 遇到一次大範圍掃描（把整個 cache 灌滿一堆只用一次的 key）會把真正的熱資料擠掉，命中率就拉不起來。所以實務常用 LRU 跟 LFU 的混合（W-TinyLFU、ARC），同時看「最近」跟「常用」。

---

eviction policy 決定 cache 滿了踢誰。LRU（最久沒用）最常見，但要看存取模式選，挑錯命中率就上不去。
