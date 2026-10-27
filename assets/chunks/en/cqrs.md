---
title: "CQRS"
slug: cqrs
brief: "Different models for reads and writes. Most systems do not need it, but in the right situation there is no better alternative."
article: scaling-first-move
date: 2026-04-07
updated: 2026-10-18
revisions: 2
---

# CQRS

Command Query Responsibility Segregation. Writes and reads use different models: the data structure for writes is designed around "how to change it without mistakes", the one for reads around "what the screen needs". The two models can live in the same database or in separate ones; the example below adds one table in the same DB as the query model.

## Why separate them

Start with what it looks like before the split. An online shop keeps its orders in three normalized tables: orders, order_items and products. The report the boss wants, "monthly sales by product category", is computed fresh every time the report page opens. It JOINs the three tables, orders holds 20 million rows, and the scan and sum take 8 seconds. Checkout writes land on the same three tables at the same time, the report's big JOIN fills the DB's CPU, and checkout slows down with it.

The two sides want different things from the start. Writes want normalization: one product name stored once, a price change made in one place. Reads want a table where one row answers the question, with no JOIN.

CQRS adds one table, monthly_sales_summary, where a single row reads "September 2026, electronics, 1,240,000". The report page reads only this table, one SELECT, 20 milliseconds. How does this table keep up with writes? After checkout writes into orders, it publishes an OrderPlaced event into a message queue, and a consumer receives it and adds the amount to the row for that month and that category.

```text
write → Command Model (orders + order_items + products)
          └→ OrderPlaced event → queue → consumer
read  → Query Model (monthly_sales_summary)
```

## Cost

The event travels asynchronously, so a few seconds can pass between a successful checkout and the summary row being updated, and during those seconds the report is one order short. That is eventual consistency. If the consumer is down for an hour, the report is an hour short, while the orders table looks perfectly normal; only comparing the two sides shows the gap. There are also two schemas to maintain now: adding a column to orders may mean changing summary too.

## When it is worth it

The read schema and the write schema differ a lot, read and write volumes differ by orders of magnitude, or the system already publishes events, so the query model updates by subscribing to what exists. Most CRUD systems do not need it; one table and a few indexes are enough. Even the 8 second report above does not necessarily need it: a monthly report's numbers rarely change, so an index, or caching the result for a few minutes, stops the report from competing with checkout for CPU every time it opens. It serves as the example because it makes it easiest to see why the two sides want different models.

monthly_sales_summary could also be an ordinary summary table, such as a PostgreSQL materialized view. The difference is how it is updated. REFRESH MATERIALIZED VIEW runs the whole JOIN again every time, still competing with checkout for CPU on the same DB; the CQRS consumer adds one amount to one row per order. The table becomes part of CQRS once the code splits into two paths: writes touch only the command model, reads touch only the query model, and events keep the two in sync.
