---
title: "權限該 app 管，還是 DB 自己管（DCL）"
slug: db-access-control
subtitle: "DB 權限從 table 到 row 到 column。微服務怎麼隔離，多租戶怎麼過濾，密碼放哪裡。"
tags: [postgresql, mysql, mongodb, rls, microservice, multi-tenant, system-design-interview]
date: 2026-03-31
related: [db-connections, pg-tradeoff]
---

# 權限該 app 管，還是 DB 自己管（DCL）

連線字串裡有 user 和 password。這個 user 從哪來？誰決定它能做什麼？

```text
psql://myuser:mypass@host:5432/mydb
         ↑       ↑
    DB 自己管的帳號，不是 OS 的使用者
```

---

## SQL 指令的五種分類，GRANT 屬於 DCL

GRANT 屬於哪一類？SQL 指令按用途分成五種：

| 分類 | 全名 | 做什麼 | 指令 |
|---|---|---|---|
| **DQL** | Data Query Language | 查資料 | SELECT |
| **DML** | Data Manipulation Language | 改資料 | INSERT, UPDATE, DELETE |
| **DDL** | Data Definition Language | 定義結構 | CREATE, ALTER, DROP, TRUNCATE |
| **DCL** | Data Control Language | 控制權限 | GRANT, REVOKE |
| **TCL** | Transaction Control Language | 控制交易 | BEGIN, COMMIT, ROLLBACK, SAVEPOINT |

```text
DQL 決定能看到什麼     → SELECT * FROM orders
DML 決定裡面放什麼     → INSERT INTO orders VALUES (...)
DDL 決定表長什麼樣     → CREATE TABLE orders (...)
DCL 決定誰能碰這張表   → GRANT SELECT ON orders TO analyst
TCL 決定操作要不要算數  → BEGIN ... COMMIT
```

---

## 情境一：新人 onboarding，給他一個 DB 帳號

新來的 data analyst 要看報表。不能讓他用 superuser 連 production DB。

```sql
-- 建帳號
CREATE ROLE analyst WITH LOGIN PASSWORD 'pass123';

-- 只能讀，不能寫
GRANT SELECT ON ALL TABLES IN SCHEMA public TO analyst;
```

他能 `SELECT * FROM orders`，但 `DELETE FROM orders` 會被拒絕。`ALL TABLES` 只涵蓋現在已經存在的表，之後新建的表要另外用 `ALTER DEFAULT PRIVILEGES` 設定。

如果連 salary 欄位都不想讓他看，光加 column 權限不夠。前面已經給了整張 users 表的 SELECT，table 層的權限會涵蓋所有欄位，所以要先收回，再只給這兩欄：

```sql
-- 收回整張表的 SELECT
REVOKE SELECT ON users FROM analyst;

-- 只能看 name 和 email，看不到 salary
GRANT SELECT(name, email) ON users TO analyst;
```

這就是 **column 等級**的權限控制。

---

## 情境二：每個微服務用獨立的 DB 帳號來識別

三個微服務共用一台 PostgreSQL。如果全用同一個帳號，Order Service 的 bug 可能誤刪 users 表。

```text
User Service    → DB user: user_svc
Order Service   → DB user: order_svc
Payment Service → DB user: payment_svc
```

```sql
-- order_svc 只能碰自己的表
GRANT SELECT, INSERT, UPDATE ON orders, order_items TO order_svc;

-- order_svc 需要查用戶資料，但只能讀
GRANT SELECT ON users TO order_svc;

-- order_svc 完全不能碰 payments 表
-- （不 GRANT 就是沒權限，不需要額外設定）
```

Order Service 被攻破了？攻擊者拿到 `order_svc` 的帳號，能讀 users 但改不了，完全碰不到 payments。**最小權限原則**：只給需要的，不多給。

### 服務對服務的權限

DB 帳號管的是「誰能碰哪張表」。但微服務之間還有 API 呼叫：

```text
Order Service → 呼叫 Payment Service 的 /charge API
```

這層的權限控制不在 DB，在網路和 application 層：

| 方式 | 做法 | 適合 |
|---|---|---|
| **Network Policy** | k8s 層面限制哪些 pod 能連哪些 pod | 粗粒度隔離 |
| **mTLS** | 雙向 TLS 憑證，Service Mesh（Istio）自動處理 | 大型 k8s 環境 |
| **JWT / API Key** | 每個服務有自己的 token，呼叫時帶上 | 簡單直接 |
| **IAM** | AWS IAM role，Lambda A 能呼叫 Lambda B | AWS 生態 |

實務上會幾層一起用：

```text
粗粒度：Network Policy（只有 order-service 能連到 payment-service）
中粒度：mTLS（確認對方真的是 order-service，不是冒充的）
細粒度：JWT claims（order-service 只能呼叫 /charge，不能呼叫 /refund）
```

---

## 情境三：multi tenant，每個客戶只能看自己的資料

SaaS 產品，所有客戶的資料存在同一張表。客戶 A 登入後，不能看到客戶 B 的訂單。

### 方法一：Application 層過濾

每個 query 都加 `WHERE tenant_id = ?`。

```text
SELECT * FROM orders WHERE tenant_id = 'tenant_a'
```

問題是這要靠工程師記得加。哪天有人忘了加 WHERE，客戶 B 的資料就外洩了。

### 方法二：PostgreSQL Row-Level Security

DB 層強制過濾，不管 application 寫什麼 query，PostgreSQL 自動加上條件。

```sql
-- 開啟 RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 定義 policy：每個租戶只看到自己的資料
CREATE POLICY tenant_isolation ON orders
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id'));
```

```text
Application 設定 session variable：
  SET app.tenant_id = 'tenant_a';

SELECT * FROM orders;
-- PostgreSQL 自動改寫成：
SELECT * FROM orders WHERE tenant_id = 'tenant_a';
```

工程師忘了加 WHERE 也沒關係，PostgreSQL 會自己加上。例外是 superuser、有 `BYPASSRLS` 的角色跟 table owner，它們預設不受 RLS 限制。table owner 可以靠對這張表加上 `FORCE ROW LEVEL SECURITY` 收回來，superuser 跟 `BYPASSRLS` 則一律繞過，所以 application 要用另一個一般角色連線。

### USING vs WITH CHECK

兩種 clause，控制不同方向：

```sql
CREATE POLICY tenant_orders ON orders
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id'))
  WITH CHECK (tenant_id = current_setting('app.tenant_id'));
```

| Clause | 控制什麼 | 適用操作 |
|---|---|---|
| **USING** | 哪些既有 row 可被讀取/修改/刪除 | SELECT / UPDATE / DELETE |
| **WITH CHECK** | 寫入的 row 是否合法 | INSERT / UPDATE |

USING 限制讀取，tenant_a 讀不到 tenant_b 的 row。
WITH CHECK 限制寫入，tenant_a 不能 INSERT 一筆 `tenant_id = 'tenant_b'` 的資料。

預設建立的是 permissive policy，多條之間是 OR 關係，任一條通過就放行。另外可以建 restrictive policy，它跟其他 policy 是 AND 關係，一定要通過。

### Supabase 的做法

Supabase 用 JWT token 帶 user identity。PostgREST（Supabase 放在前面、把 HTTP request 轉成 SQL 的那層 server）把 token 解開後設成 PostgreSQL session variable。`auth.uid()` 讀的就是這個值。

```text
前端 request（帶 JWT）
  → PostgREST 解 token，設 session variable
  → PostgreSQL 執行 query + RLS policy 自動過濾
  → 只回傳該 user 有權限的 row
```

Application 不需要自己寫 `WHERE user_id = ?`，因為 PostgreSQL 會在 DB 層強制過濾。

---

## 情境四：密碼放哪裡

`order_svc` 的密碼寫在程式碼裡？寫在 `.env` 裡 commit 上去？

```text
# 千萬不要這樣
DATABASE_URL=psql://order_svc:super_secret@host:5432/mydb
git add .env
git push  ← 密碼上了 GitHub，任何人都讀得到
```

| 方式 | 做法 | 適合 |
|---|---|---|
| **環境變數** | 部署時注入，不進 git | 最基本，但 process dump 可能洩漏 |
| **K8s Secrets** | 存在 k8s etcd 裡，mount 成檔案或環境變數（預設只做 base64，沒有加密） | k8s 環境 |
| **AWS Secrets Manager** | 託管服務，自動 rotate 密碼 | AWS 生態 |
| **HashiCorp Vault** | 集中管理，audit log，動態生成 DB 帳號 | 大型系統 |

Vault 可以動態產生帳號。service 跟 Vault 要 DB 帳號時，Vault 當場建一個臨時帳號（例如 TTL 24 小時），到期自動刪除。這樣就不需要長期存在的密碼，就算洩漏了也只有短時間有效。

---

## 各 DB 的權限粒度比較

| 粒度 | PostgreSQL | MySQL | MongoDB | DynamoDB |
|---|---|---|---|---|
| Database | GRANT CONNECT | GRANT ALL ON db | 有 | IAM policy |
| Table | GRANT SELECT/INSERT/... | GRANT SELECT/INSERT/... | collection 層（自訂 role） | IAM per table |
| Column | GRANT SELECT(col) | GRANT SELECT(col) | 不支援 | IAM `dynamodb:Attributes` condition |
| Row | RLS | 不支援（用 view 繞） | 不支援 | IAM LeadingKeys condition |
| Cell | 不直接支援 | 不支援 | 不支援 | 不支援 |

PostgreSQL 的權限模型最完整。MySQL 缺 RLS 但能用 view 繞。MongoDB 只到 collection 層級。DynamoDB 靠 AWS IAM，不在 DB 內部管。

### 超級使用者

PostgreSQL 安裝時預設建立 `postgres` superuser，繞過所有權限檢查（包括 RLS）。

```sql
SELECT rolname, rolsuper FROM pg_roles;

rolname   | rolsuper
----------+---------
postgres  | t        ← 超級使用者
order_svc | f
analyst   | f
```

### 認證 vs 授權

| | 認證（Authentication） | 授權（Authorization） |
|---|---|---|
| 問什麼 | 你是誰 | 你能做什麼 |
| PostgreSQL | pg_hba.conf | GRANT / REVOKE / RLS |
| MySQL | mysql.user 表 | GRANT / REVOKE |
| MongoDB | SCRAM-SHA-256 | 內建 role |
| DynamoDB | AWS IAM credentials | IAM policy |
