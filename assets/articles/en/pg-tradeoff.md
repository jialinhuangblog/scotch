---
title: "A PostgreSQL connection costs more than a MySQL one. Why pick it anyway?"
slug: pg-tradeoff
subtitle: "One process per connection, which uses more memory than MySQL's one thread per connection. The reasons to pick it sit on the other side: JSONB, CTE, partial index, features MySQL lacks or does weakly."
tags: [postgresql, mysql, system-design-interview]
date: 2026-04-02
updated: 2026-10-17
revisions: 1
related: [db-connections, db-access-control]
---

# A PostgreSQL connection costs more than a MySQL one. Why pick it anyway?

The same `SELECT * FROM orders WHERE id = 1`, sent to PostgreSQL and to MySQL, returns the same result. What happens underneath is different.

---

## The design split: process vs thread

100 connections arrive at once.

For every connection PostgreSQL forks a new OS process. Each process has its own separate address space, and [measurements](https://blog.anarazel.de/2020/10/07/measuring-the-memory-overhead-of-a-postgres-connection/) put each one at roughly 1.3 MiB to 7.6 MiB, depending on whether huge_pages is on. 100 connections means 100 processes, so the connections alone use somewhere between a little over 100 MB and a little over 700 MB. The numbers in `ps` and `top` look much larger, because they count the shared buffers, which are shared, against every process. The OS has to context switch between 100 processes, and the more processes, the more time goes to context switching.

For every connection MySQL opens a thread. Threads share the address space of one process, and each only needs its own stack (a few hundred KB). 100 connections = 100 threads, all inside one process, and switching between threads is much faster than between processes.

So a few thousand connections on MySQL is not a big problem, while a few hundred on PostgreSQL already calls for PgBouncer as a connection pool. What a connection costs and how PgBouncer solves it is in [Connections are not free](article://db-connections).

PostgreSQL chose the process model on purpose. Each connection's memory is isolated from the others, so a backend that corrupts its own memory does not write over anyone else's directly. But that does not mean one connection crashing leaves the others untouched. As soon as one backend terminates abnormally, the postmaster drops every connection and runs crash recovery, to protect shared memory.

How other databases chose:

| Database | Model | Note |
|---|---|---|
| PostgreSQL | process per connection | good isolation, heavy |
| MySQL | thread per connection | light, but weak isolation |
| Oracle | process (dedicated) or shared server | configurable, default is a dedicated process |
| SQL Server | thread + fiber mode | like MySQL, thread-based |
| SQLite | single process, no server | embedded, not a client-server architecture |

---

## What PostgreSQL has that MySQL does not

Every feature below is one MySQL either lacks or added very late, while PostgreSQL has had it from early on.

### CTE (Common Table Expression): no need to write a subquery twice

A CTE is a "temporarily named subquery" in SQL. `WITH ... AS (...)` gives a piece of a query a name that can be referenced again later. It exists only inside that one query and is never stored as a table or view.

Say you want the departments whose average salary is above "the average of the department averages", where every department counts once no matter how many people it has. That uses the department averages twice: once to list each department, once to average them. Without a CTE, the same subquery has to be written twice:

```sql
SELECT dept, avg_salary
FROM (SELECT dept, AVG(salary) AS avg_salary FROM employees GROUP BY dept) sub
WHERE avg_salary > (SELECT AVG(avg_salary)
                    FROM (SELECT dept, AVG(salary) AS avg_salary FROM employees GROUP BY dept) sub2);
```

The two subqueries are identical. If the calculation changes later, for example to leave out interns, both have to be edited, and editing only one gives a wrong result. A CTE names it once and the query references it twice:

```sql
WITH dept_avg AS (
  SELECT dept, AVG(salary) AS avg_salary FROM employees GROUP BY dept
)
SELECT dept, avg_salary FROM dept_avg
WHERE avg_salary > (SELECT AVG(avg_salary) FROM dept_avg);
```

Try three departments: eng has three people at 100, sales one person at 40, ops two people at 75. The department averages are 100, 40 and 75, which average to 71.7, and both queries return eng and ops (script in `bench/pg-cte-twice/`). Compare against the company-wide average of 81.7 instead and only eng is left.

MySQL did not support CTEs until 8.0 (2018). Before that the only options were nested subqueries, or computing it in the application layer.

### Window Functions: the detail rows and the statistics at the same time

The boss wants a report where every order's amount has the customer's running total next to it. GROUP BY merges one customer's rows into a single row, and the individual orders disappear. Without GROUP BY, there is no way to compute the running total.

```sql
SELECT order_id, amount,
       SUM(amount) OVER (PARTITION BY customer_id ORDER BY created_at) AS running_total
FROM orders;
```

Every order is still its own row, with the running total beside it.

MySQL again did not support this until 8.0. Before 2018, MySQL needed a correlated subquery or a session variable hack to work around it, with poor performance and poor readability.

### JSONB: columns that are not fixed

An e-commerce platform. Phones have "screen size, RAM", clothes have "size, color". One column per attribute gives a table with hundreds of columns, mostly NULL. A separate `product_attributes` relation table means a JOIN on every product lookup.

```sql
INSERT INTO products (name, attrs)
VALUES ('iPhone', '{"screen": "6.1", "ram": "8GB"}');

SELECT * FROM products WHERE attrs->>'ram' = '8GB';

CREATE INDEX ON products USING GIN (attrs);
```

All the variable attributes go into one JSONB column, and it can still be queried and indexed. MySQL 5.7 added a JSON type, but has no index like GIN that covers the whole JSON document. To index one field inside the JSON, you first pull it out as a generated column and index that. From 8.0.17 there is also the multi-valued index, which can index a JSON array.

### Partial Index: indexing the whole table is a waste

The orders table has ten million rows, and only the pending ones are queried often. In an index over the whole table, 99% of the entries are completed orders that only take up space and slow down writes.

```sql
CREATE INDEX ON orders (created_at) WHERE status = 'pending';
```

Only the few thousand pending rows are indexed. The index shrinks from a few GB to a few MB. PostgreSQL's query planner decides on its own: it uses this index only when the query's WHERE clause implies the index condition (for example the query itself contains `status = 'pending'`), so it is certain every row it needs is in the index.

MySQL still does not support partial indexes.

### Array: a many-to-many relation needs three tables

An article has several tags. The textbook way is three tables: `articles`, `tags`, `article_tags`. Finding "articles with a given tag" is a JOIN across two tables. If tags do not need to be managed on their own, an array is enough:

```sql
tags TEXT[] = {'db', 'postgresql', 'rls'}

SELECT * FROM articles WHERE 'rls' = ANY(tags);
```

One relation table and one JOIN saved. MySQL does not support array columns.

### Custom Types: the same group of columns everywhere

The `users` table has `home_city, home_zip`, the `orders` table has `shipping_city, shipping_zip`, the `warehouses` table has `location_city, location_zip`. Three tables each write the two columns, and a format change means changing three places.

```sql
CREATE TYPE address AS (city TEXT, zip TEXT);

ALTER TABLE users ADD COLUMN home address;
ALTER TABLE orders ADD COLUMN shipping address;
```

Changing the structure of address is one change in one place. MySQL does not support custom types.

---

## Built-in pub/sub: LISTEN/NOTIFY

In most databases, a data change is the end of the story. Clients outside do not know. The only way to find out whether something changed is polling.

PostgreSQL has a pub/sub mechanism built in. Paired with a trigger, a data change can notify a client that is waiting outside, the moment it happens.

First define the notification function, then bind a trigger to the INSERT event on the orders table:

```sql
-- 1. Define the function: call pg_notify to send the notification
CREATE FUNCTION notify_new_order() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('order_created', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Bind the trigger: on every INSERT into orders, call the function above
CREATE TRIGGER on_order_insert
  AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION notify_new_order();
```

The function defines what to do (send the notification). The trigger defines when to do it (`AFTER INSERT ON orders`).

On the client side, open a connection and run `LISTEN order_created`. Handle each notification as it arrives. No polling, and the latency is close to zero.

### Limits

LISTEN only applies to that one connection. When the connection drops, the subscription is gone. Notifications sent while it was down are simply discarded. There is no persistence, no retry, no consumer group.

Where it fits: lightweight real-time notification. "A new order came in, refresh the dashboard." A missed notification means at worst a few seconds of delay until the next poll picks it up.

Where it does not fit: "This payment must be processed." A missed one is a bug. That calls for a message queue (RabbitMQ, Kafka), or at least Redis pub/sub paired with a persisted changelog.

A common evolution path in production: start with LISTEN/NOTIFY for real-time notification → once the scale grows, switch to WAL logical replication + Redis pub/sub, so notifications are decoupled from the DB connection.

---

## RLS (Row-Level Security): access control at the DB layer

A multi-tenant SaaS, where every customer's data lives in the same table. Relying on the application to add `WHERE tenant_id = ?` to every query means that the day someone forgets, data leaks.

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON orders
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id'));
```

Whatever query the application writes, PostgreSQL adds this condition automatically. The exceptions are the superuser, roles with `BYPASSRLS`, and the table owner, which are not restricted by RLS by default. The table owner exception can be removed by adding `FORCE ROW LEVEL SECURITY` to the table. The superuser and `BYPASSRLS` always bypass it, so the application has to connect as a separate ordinary role.

MySQL does not support RLS. For multi-tenant isolation, the only options are discipline in the application layer, or a workaround with views (but a view cannot force every query to go through it).

The full RLS mechanism, and how Supabase uses it, is in [You cannot touch this table](article://db-access-control).

---

## Decision path

**Teams that start with PostgreSQL:** anyone who needs RLS, JSONB, CTEs or Window Functions. Multi-tenant SaaS, a data structure that mixes fixed and variable columns, complex report queries. Pick PostgreSQL from the start and there is no migration later.

**Teams that start with MySQL:** simple needs (CRUD + basic JOINs), a team that knows MySQL, high connection counts but low feature demands. MySQL's thread model copes more easily under a high connection count, and a connection pooler may not be needed.

**When choosing MySQL becomes a regret:** the requirements grow complex. Multi-tenancy without RLS, storing JSON without a GIN index, complex reports without CTEs and Window Functions before 8.0. Every missing feature has to be patched in the application layer, and after enough patches you have rebuilt PostgreSQL in the application layer.

**When choosing PostgreSQL becomes a regret:** connection management was not done well. A few hundred direct connections, no PgBouncer, and the CPU is spent on process context switches instead of running queries. Or a serverless architecture (every Lambda invocation opens a connection), and a sudden few thousand connections exceed `max_connections`. These problems come from infra that was not set up properly, not from a missing feature.

**What to do about the regret:** migrating MySQL → PostgreSQL is expensive (SQL syntax differences, stored procedures, and the permission model all differ). PostgreSQL's connection problem is solved by adding PgBouncer, at a much lower cost. So when future requirements are uncertain, PostgreSQL is the safer starting point.
