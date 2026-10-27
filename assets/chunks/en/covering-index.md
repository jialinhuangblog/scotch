---
title: "Covering Index"
slug: covering-index
brief: "When the columns a query needs are all in the index, there is no trip back to the table; a composite index has to be used from its leftmost column, and a query without that column cannot use the index."
date: 2026-07-20
---

# Covering Index

Not a special index type, but a state: when the columns a query needs all happen to be in the index, that index is covering for that query. No need to go back to the table for another fetch.

```sql
CREATE INDEX ON users(email, name);

SELECT name FROM users WHERE email = 'a@x.com';
-- email and name are both in the index → covering, done in one step

SELECT * FROM users WHERE email = 'a@x.com';
-- * includes other columns, the index is not enough → still has to go back to the table
```

## Column order in a composite index

`(email, name)` and `(name, email)` are different indexes. The B+ Tree sorts by the first column, then by the second. A query has to use the index starting from the leftmost column; without the leftmost column it cannot use the index.

```text
index on (tenant_id, created_at)

WHERE tenant_id = 'acme'                    → uses the index (has the leftmost column)
WHERE tenant_id = 'acme' AND created_at > x → uses the index
WHERE created_at > x                        → cannot use this index, falls back to a full table scan
```

In practice, put the most selective column leftmost. One `tenant_id` value narrows the data down to a single tenant, and `created_at` then sorts within that range. Put them the other way, `(created_at, tenant_id)`, and a query with only `tenant_id` lacks the leftmost column and cannot use the index.

## Cost

Every INSERT / UPDATE / DELETE has to update every index involved. Three indexes means three B+ Tree updates. Adding columns so that more queries become covering makes writes slower.
