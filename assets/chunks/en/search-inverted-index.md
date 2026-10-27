---
title: "Inverted Index"
slug: search-inverted-index
brief: "Word → documents, instead of document → words. The structure behind every full text search."
date: 2026-03-09
updated: 2026-04-08
revisions: 1
---

# Inverted Index

> The core data structure of Elasticsearch, Lucene and Solr. Also used by PostgreSQL's GIN index.

## The problem

The database holds a million articles. A user searches for "distributed consensus", and every article containing both words has to be found.

The most direct way is to read all one million articles one by one and check each for the two words. One search takes tens of seconds.

## Forward Index vs Inverted Index

A forward index is "document → which words it contains". The direction a person writes in.

```text
Forward Index:
  doc1 → ["distributed", "systems", "consensus"]
  doc2 → ["database", "consensus", "raft"]
  doc3 → ["distributed", "tracing", "logging"]
```

Searching for "distributed" means reading every document to see which ones contain the word. More documents, slower search.

An inverted index goes the other way: "word → which documents it appears in".

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

Searching for "distributed" is one table lookup that returns [doc1, doc3], with no need to read every document.

Searching for "distributed consensus"? Take the intersection:

```text
"distributed" → [doc1, doc3]
"consensus"   → [doc1, doc2]
intersection → [doc1]
```

## Building the index

An article comes in and goes through three steps to become inverted index entries:

```text
Original: "The Raft consensus algorithm is distributed."

1. Tokenize (split into words)
   → ["The", "Raft", "consensus", "algorithm", "is", "distributed"]

2. Normalize
   → lowercase: ["the", "raft", "consensus", "algorithm", "is", "distributed"]
   → remove stop words (the, is): ["raft", "consensus", "algorithm", "distributed"]

3. Index (write into the inverted index)
   → "raft" → [doc1]
   → "consensus" → [doc1]
   → "algorithm" → [doc1]
   → "distributed" → [doc1]
```

Elasticsearch calls steps 1 and 2 the analyzer. Different languages use different analyzers: English splits on spaces, Chinese needs a word segmenter (jieba, IK).

## Posting List

The list of documents a word points to is called a posting list. What is actually stored is not just document IDs, but positions and frequencies too:

```text
"consensus" → [
  {doc1, freq: 3, positions: [5, 28, 41]},
  {doc2, freq: 1, positions: [12]}
]
```

Positions are used for phrase queries: searching "distributed consensus" requires the two words to appear next to each other. Knowing both are in doc1 is not enough; the positions have to be consecutive.

Frequency (freq) is used to compute the relevance score. More occurrences, higher score.

## Difference from a B-tree

A B-tree is good at exact matches and range queries: `WHERE id = 42`, `WHERE price BETWEEN 10 AND 50`.

An inverted index is good at full text search: "every document containing a given word". A B-tree cannot do that, unless every word is made a key in the index, and it does not support tokenizing or relevance ranking either.

PostgreSQL's GIN (Generalized Inverted Index) is an inverted index implementation, used for full text search and JSONB queries.
