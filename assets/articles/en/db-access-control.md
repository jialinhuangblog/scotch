---
title: "App or DB: who manages permissions (DCL, Data Control Language)?"
slug: db-access-control
subtitle: "DB permissions from table to row to column. How microservices are isolated, how multi-tenant data is filtered, where the password goes."
tags: [postgresql, mysql, mongodb, rls, microservice, multi-tenant, system-design-interview]
date: 2026-03-31
updated: 2026-10-17
revisions: 1
related: [db-connections, pg-tradeoff]
---

# App or DB: who manages permissions (DCL, Data Control Language)?

The connection string has a user and a password. Where does this user come from? Who decides what it can do?

```text
postgresql://myuser:mypass@host:5432/mydb
               ↑       ↑
    an account the DB manages itself, not an OS user
```

---

## Five kinds of SQL commands, and GRANT is DCL

Which kind is GRANT? SQL commands fall into five kinds by purpose:

| Kind | Full name | Does what | Commands |
|---|---|---|---|
| **DQL** | Data Query Language | read data | SELECT |
| **DML** | Data Manipulation Language | change data | INSERT, UPDATE, DELETE |
| **DDL** | Data Definition Language | define structure | CREATE, ALTER, DROP, TRUNCATE |
| **DCL** | Data Control Language | control permissions | GRANT, REVOKE |
| **TCL** | Transaction Control Language | control transactions | BEGIN, COMMIT, ROLLBACK, SAVEPOINT |

```text
DQL decides what you can see          → SELECT * FROM orders
DML decides what goes inside          → INSERT INTO orders VALUES (...)
DDL decides what the table looks like → CREATE TABLE orders (...)
DCL decides who can touch the table   → GRANT SELECT ON orders TO analyst
TCL decides whether the work counts   → BEGIN ... COMMIT
```

---

## Scenario one: onboarding a new hire, give them a DB account

A new data analyst needs to look at reports. They cannot connect to the production DB as superuser.

```sql
-- create the account
CREATE ROLE analyst WITH LOGIN PASSWORD 'pass123';

-- read only, no writes
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analyst;
```

They can `SELECT * FROM orders`, but `DELETE FROM orders` is refused. `ALL TABLES` covers only the tables that exist right now; tables created later need a separate `ALTER DEFAULT PRIVILEGES`.

If they should not see the salary column either, adding a column permission alone is not enough. SELECT on the whole users table was already granted above, and a table level permission covers every column, so revoke it first, then grant only these two columns:

```sql
-- revoke SELECT on the whole table
REVOKE SELECT ON users FROM analyst;

-- can see name and email, not salary
GRANT SELECT(name, email) ON users TO analyst;
```

This is **column level** permission control.

---

## Scenario two: each microservice identified by its own DB account

Three microservices share one PostgreSQL. If they all use the same account, a bug in the Order Service could delete the users table by mistake.

```text
User Service    → DB user: user_svc
Order Service   → DB user: order_svc
Payment Service → DB user: payment_svc
```

```sql
-- order_svc can only touch its own tables
GRANT SELECT, INSERT, UPDATE ON orders, order_items TO order_svc;

-- order_svc needs to look up user data, but read only
GRANT SELECT ON users TO order_svc;

-- order_svc cannot touch the payments table at all
-- (no GRANT means no permission; nothing extra to set)
```

Order Service compromised? The attacker holds the `order_svc` account: it can read users but not change them, and cannot touch payments at all. **Principle of least privilege**: grant only what is needed, nothing more.

### Service to service permissions

DB accounts control "who can touch which table". But microservices also call each other's APIs:

```text
Order Service → calls the Payment Service's /charge API
```

Permission control at this level is not in the DB. It is in the network and application layers:

| Method | How | Fits |
|---|---|---|
| **Network Policy** | at the k8s level, restrict which pods can connect to which pods | coarse isolation |
| **mTLS** | TLS certificates in both directions, handled by the Service Mesh (Istio) | large k8s environments |
| **JWT / API Key** | each service has its own token and sends it with the call | simple and direct |
| **IAM** | AWS IAM role, Lambda A may call Lambda B | the AWS ecosystem |

In practice several layers are used together:

```text
coarse: Network Policy (only order-service can connect to payment-service)
medium: mTLS (confirm the caller really is order-service, not an impostor)
fine:   JWT claims (order-service can call /charge but not /refund)
```

---

## Scenario three: multi tenant, each customer sees only its own data

A SaaS product stores every customer's data in the same table. After customer A logs in, it must not see customer B's orders.

### Method one: filter in the application layer

Every query adds `WHERE tenant_id = ?`.

```text
SELECT * FROM orders WHERE tenant_id = 'tenant_a'
```

The problem is that this depends on engineers remembering to add it. The day someone forgets the WHERE, customer B's data leaks.

### Method two: PostgreSQL Row-Level Security

The DB layer enforces the filter. Whatever query the application writes, PostgreSQL adds the condition automatically.

```sql
-- enable RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- define the policy: each tenant sees only its own data
CREATE POLICY tenant_isolation ON orders
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id'));
```

```text
The application sets a session variable:
  SET app.tenant_id = 'tenant_a';

SELECT * FROM orders;
-- PostgreSQL rewrites it to:
SELECT * FROM orders WHERE tenant_id = 'tenant_a';
```

If an engineer forgets the WHERE, it does not matter; PostgreSQL adds it. The exceptions are the superuser, roles with `BYPASSRLS`, and the table owner, which are not restricted by RLS by default. The table owner can be brought back under it with `FORCE ROW LEVEL SECURITY` on the table, but the superuser and `BYPASSRLS` always bypass it, so the application has to connect as a separate ordinary role.

### USING vs WITH CHECK

Two clauses, controlling different directions:

```sql
CREATE POLICY tenant_orders ON orders
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id'))
  WITH CHECK (tenant_id = current_setting('app.tenant_id'));
```

| Clause | Controls what | Operations |
|---|---|---|
| **USING** | which existing rows can be read / changed / deleted | SELECT / UPDATE / DELETE |
| **WITH CHECK** | whether a written row is allowed | INSERT / UPDATE |

USING limits reads: tenant_a cannot read tenant_b's rows.
WITH CHECK limits writes: tenant_a cannot INSERT a row with `tenant_id = 'tenant_b'`.

A policy is permissive by default: several of them are combined with OR, and passing any one lets the row through. A restrictive policy can also be created; it is combined with the other policies by AND and must pass.

### How Supabase does it

Supabase carries the user identity in a JWT token. PostgREST (the server Supabase puts in front, which turns HTTP requests into SQL) decodes the token and sets it as a PostgreSQL session variable. `auth.uid()` reads that value.

```text
frontend request (with JWT)
  → PostgREST decodes the token, sets the session variable
  → PostgreSQL runs the query + the RLS policy filters automatically
  → only the rows this user is allowed to see come back
```

The application does not need to write `WHERE user_id = ?` itself, because PostgreSQL enforces the filter at the DB layer.

---

## Scenario four: where the password goes

Is the `order_svc` password written in the code? In a `.env` file that gets committed?

```text
# never do this
DATABASE_URL=postgresql://order_svc:super_secret@host:5432/mydb
git add .env
git push  ← the password is on GitHub, anyone can read it
```

| Method | How | Fits |
|---|---|---|
| **Environment variables** | injected at deploy time, never enters git | the baseline, but a process dump can leak it |
| **K8s Secrets** | stored in k8s etcd, mounted as a file or environment variable (base64 only by default, not encrypted) | k8s environments |
| **AWS Secrets Manager** | managed service, rotates passwords automatically | the AWS ecosystem |
| **HashiCorp Vault** | central management, audit log, generates DB accounts dynamically | large systems |

Vault can generate accounts dynamically. When a service asks Vault for a DB account, Vault creates a temporary one on the spot (for example with a 24 hour TTL) and deletes it when it expires. No long lived password is needed, and even a leaked one is valid only for a short time.

---

## Permission granularity across DBs

| Granularity | PostgreSQL | MySQL | MongoDB | DynamoDB |
|---|---|---|---|---|
| Database | GRANT CONNECT | GRANT ALL ON db | yes | IAM policy |
| Table | GRANT SELECT/INSERT/... | GRANT SELECT/INSERT/... | collection level (custom roles) | IAM per table |
| Column | GRANT SELECT(col) | GRANT SELECT(col) | not supported | IAM `dynamodb:Attributes` condition |
| Row | RLS | not supported (work around with a view) | not supported | IAM LeadingKeys condition |
| Cell | not directly supported | not supported | not supported | not supported |

PostgreSQL has the most complete permission model. MySQL lacks RLS but a view can work around it. MongoDB goes down only to the collection level. DynamoDB relies on AWS IAM; permissions are not managed inside the DB.

### The superuser

A PostgreSQL install creates the `postgres` superuser by default, which bypasses every permission check (RLS included).

```sql
SELECT rolname, rolsuper FROM pg_roles;

rolname   | rolsuper
----------+---------
postgres  | t        ← superuser
order_svc | f
analyst   | f
```

### Authentication vs authorization

| | Authentication | Authorization |
|---|---|---|
| The question | who are you | what can you do |
| PostgreSQL | pg_hba.conf | GRANT / REVOKE / RLS |
| MySQL | the mysql.user table | GRANT / REVOKE |
| MongoDB | SCRAM-SHA-256 | built-in roles |
| DynamoDB | AWS IAM credentials | IAM policy |
