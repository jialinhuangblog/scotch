---
title: "DB Access Control"
slug: db-access-control
brief: "Who can access which data, from table down to row. Each DB controls it at a different granularity."
article: db-access-control
date: 2026-03-31
updated: 2026-10-18
revisions: 4
---

# DB Access Control

SQL's DCL (Data Control Language) has only two verbs, GRANT and REVOKE. They decide which account can do what to which data.

## Permission granularity

| Granularity | PostgreSQL | MySQL | MongoDB | DynamoDB |
|---|---|---|---|---|
| Database | GRANT CONNECT | GRANT ALL ON db | yes | IAM policy |
| Table | GRANT SELECT/INSERT/... | GRANT SELECT/INSERT/... | collection level (custom role) | IAM per table |
| Column | GRANT SELECT(col) | GRANT SELECT(col) | not supported | IAM conditions (`dynamodb:Attributes`) |
| Row | Row-Level Security | not supported (work around it with a view) | not supported | IAM conditions |

The finest level in the table is the row. One `orders` table holds every tenant's orders, with tenant_id 7, 8 and 9, and the application queries for every tenant through one DB account. That account has SELECT on `orders`, so it gets the whole table, tenant 8's orders included. The application has to remember to add `WHERE tenant_id = 7` to every query, and missing it once is a data leak. PostgreSQL's RLS (Row-Level Security) moves that WHERE into the DB:

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;  -- applies to the table owner too
CREATE POLICY by_tenant ON orders
  USING (tenant_id = current_setting('app.tenant_id')::int);
```

At the start of every transaction the application runs `SET LOCAL app.tenant_id = '7'`. After that, `SELECT * FROM orders` in the same transaction returns only the rows with tenant_id = 7, and the query itself needs no WHERE. But "which tenant is this" is still set by the application. If that step is missed, a local PostgreSQL 17 run gives this:

- The connection never set `app.tenant_id`: the query fails with `unrecognized configuration parameter "app.tenant_id"` and returns no rows.
- The application used `SET` (without LOCAL), and the connection pool hands the same connection to the next request: the 8 set by the previous request is still on the connection, so a query for tenant 7 returns tenant 8's orders.
- The application used `SET LOCAL`: the value is cleared when the transaction ends, and if the next transaction forgets to set it, the query fails with `invalid input syntax for type integer: ""`.

Of the three cases, only the second one reads another tenant's data, so set the value with `SET LOCAL` at the start of every transaction.

The `FORCE` in the second line is needed too. Superusers and accounts with the `BYPASSRLS` attribute always skip RLS, and the table owner skips it by default unless FORCE is set on the table. If the application connects with the account that created the table and FORCE is missing, the same `SELECT * FROM orders` still returns the whole table, tenant 8 and 9's orders included.

MySQL has no row level: you build a view with the WHERE in it first, then GRANT only the view. Supabase's permission system is built on RLS.

## Microservice isolation

Each service uses its own DB account, with GRANT only on the tables and operations it needs. The Order Service account has SELECT and INSERT on `orders` and `order_items`, and no permission at all on `payments`. An attacker who gets in through a SQL injection in the Order Service is holding that account; `SELECT * FROM payments` comes back as permission denied, and the payment data stays unread.

## Secret Management

DB passwords never go into git. Manage them with K8s Secrets, AWS Secrets Manager, or Vault.
