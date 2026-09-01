---
title: "Inverted Index"
slug: search-inverted-index
brief: "把詞對應到文件。全文搜尋的核心引擎。"
date: 2026-03-09
updated: 2026-04-08
revisions: 1
---

# Inverted Index

> Elasticsearch、Lucene、Solr 的核心資料結構。也用在 PostgreSQL 的 GIN index。

## 問題

資料庫存了一百萬篇文章。使用者搜尋「distributed consensus」，要找出所有包含這兩個詞的文章。

最笨的做法：掃一百萬篇，每篇檢查有沒有這兩個詞。一次搜尋要幾十秒。

## Forward Index vs Inverted Index

Forward index 是「文件 → 包含哪些詞」。人寫文章的方向。

```text
Forward Index:
  doc1 → ["distributed", "systems", "consensus"]
  doc2 → ["database", "consensus", "raft"]
  doc3 → ["distributed", "tracing", "logging"]
```

搜尋「distributed」要掃所有文件，看哪些包含這個詞。文件越多越慢。

Inverted index 反過來：「詞 → 出現在哪些文件」。

```text
Inverted Index:
  "distributed" → [doc1, doc3]
  "consensus"   → [doc1, doc2]
  "database"    → [doc2]
  "raft"        → [doc2]
  "systems"     → [doc1]
  "tracing"     → [doc3]
  "logging"     → [doc3]
```

搜尋「distributed」直接查表，拿到 [doc1, doc3]。O(1) 查表，不用掃文件。

搜尋「distributed consensus」？取交集：

```text
"distributed" → [doc1, doc3]
"consensus"   → [doc1, doc2]
交集 → [doc1]
```

## 建索引的過程

一篇文章進來，經過三個步驟變成 inverted index 的 entry：

```text
原文："The Raft consensus algorithm is distributed."

1. Tokenize（拆詞）
   → ["The", "Raft", "consensus", "algorithm", "is", "distributed"]

2. Normalize（正規化）
   → 小寫化：["the", "raft", "consensus", "algorithm", "is", "distributed"]
   → 去掉停用詞（the, is）：["raft", "consensus", "algorithm", "distributed"]

3. Index（寫入 inverted index）
   → "raft" → [doc1]
   → "consensus" → [doc1]
   → "algorithm" → [doc1]
   → "distributed" → [doc1]
```

Elasticsearch 把步驟 1-2 叫 analyzer。不同語言用不同 analyzer：英文靠空格拆詞，中文要用分詞器（jieba、IK）。

## Posting List

每個詞指向的文件清單叫 posting list。實際存的不只是文件 ID，還有位置和頻率：

```text
"consensus" → [
  {doc1, freq: 3, positions: [5, 28, 41]},
  {doc2, freq: 1, positions: [12]}
]
```

位置（position）用來做 phrase query：搜尋 "distributed consensus" 要求兩個詞相鄰出現，光知道都在 doc1 不夠，還要確認位置連續。

頻率（freq）用來算相關性分數。出現越多次，分數越高。

## 跟 B-tree 的差別

B-tree 擅長精確匹配和範圍查詢：`WHERE id = 42`、`WHERE price BETWEEN 10 AND 50`。

Inverted index 擅長全文搜尋：「包含某個詞的所有文件」。B-tree 做不了這件事，除非把每個詞都當 key 建 index，而且不支援分詞、不支援相關性排序。

PostgreSQL 的 GIN（Generalized Inverted Index）就是 inverted index 的實作，用在全文搜尋和 JSONB 查詢。

---

Inverted index 把「文件包含哪些詞」反轉成「詞出現在哪些文件」。查表拿到清單再取交集，不必逐篇掃。
