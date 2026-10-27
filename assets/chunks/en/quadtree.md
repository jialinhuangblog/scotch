---
title: "Quadtree"
slug: quadtree
brief: "Cut the map into four. Any cell too crowded gets cut into four again. Dense areas become finer on their own."
date: 2026-07-31
article: search-geo
---

# Quadtree

> [Geohash](chunk://geohash) cuts the map into cells of equal size. But one downtown cell holds ten thousand shops while one cell over the sea holds nothing; one cell size for both makes no sense. A quadtree cuts dense areas fine and leaves sparse areas as large cells.

## Mechanism: crowded means cut into four

At the start the whole map is one cell. When the points in a cell exceed its capacity (say 100), the cell is cut into four quadrants. If a cell is still crowded after the cut, that cell is cut into four again. Recurse.

```text
Whole map, one cell
  ┌───────────┐
  │           │   points > 100 → cut into four
  └───────────┘
        ↓
  ┌─────┬─────┐
  │sparse│dense│  top right > 100 again → only it gets cut again
  ├─────┼──┬──┤
  │     │  │  │
  └─────┴──┴──┘
```

The result is a tree. Leaves in dense areas are small and deep; leaves in sparse areas are large and shallow. Cell size follows point density. This is called adaptive, and it is the biggest difference from geohash.

## Query: walk only the overlapping children

"Find the points inside this rectangle": start at the top cell and walk down only into children that overlap the query range; subtrees with no overlap are skipped entirely. Same as how a [B-tree](chunk://b-tree) rules out irrelevant ranges, only in two dimensions.

## How it differs from geohash

| | geohash | quadtree |
|---|---|---|
| Cell size | Fixed, one size per precision | Adaptive, follows density |
| Data structure | String prefix, goes straight into a B-tree | Tree, maintained yourself |
| Very uneven points | Sparse areas waste cells, dense areas overflow | Handles it naturally |
| Storing in SQL | Easy (it is a string column) | Hard (a tree, usually in memory or a dedicated index) |

## Who uses it

Collision detection (a game checks only objects in nearby cells), image compression, early map services. The DB layer is a different story: PostGIS's spatial index is an R-tree (neighboring objects are boxed by a bounding box, and the boxes are wrapped level by level into a tree), not a quadtree. The two are close in concept, both relying on "split space into levels, skip irrelevant regions at query time", but differ in implementation.
