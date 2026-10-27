---
title: "DB Access Control"
slug: db-access-control
brief: "誰能存取哪些資料，從 table 到 row，各 DB 控制的細度不一樣。"
article: db-access-control
date: 2026-03-31
updated: 2026-10-18
revisions: 4
---

# DB Access Control

SQL 的 DCL（Data Control Language）只有兩個動詞，GRANT 和 REVOKE，決定哪個帳號能對哪些資料做什麼。

## 權限粒度

| 粒度 | PostgreSQL | MySQL | MongoDB | DynamoDB |
|---|---|---|---|---|
| Database | GRANT CONNECT | GRANT ALL ON db | 有 | IAM policy |
| Table | GRANT SELECT/INSERT/... | GRANT SELECT/INSERT/... | collection 層（自訂 role） | IAM per table |
| Column | GRANT SELECT(col) | GRANT SELECT(col) | 不支援 | IAM conditions（`dynamodb:Attributes`） |
| Row | Row-Level Security | 不支援（用 view 繞） | 不支援 | IAM conditions |

表裡最細的是 row 這一層。一張 `orders` 表放著所有租戶的訂單，tenant_id 分別是 7、8、9，application 用同一個 DB 帳號替所有租戶查詢。這個帳號有 `orders` 的 SELECT，拿到的就是整張表，tenant 8 的訂單也在結果裡，要靠 application 每個 query 自己記得加 `WHERE tenant_id = 7`，漏一次就是資料外洩。PostgreSQL 的 RLS（Row-Level Security）把這條 WHERE 搬進 DB：

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;  -- 連 table owner 也套用
CREATE POLICY by_tenant ON orders
  USING (tenant_id = current_setting('app.tenant_id')::int);
```

application 在每個交易開頭先跑 `SET LOCAL app.tenant_id = '7'`，之後同一個交易裡的 `SELECT * FROM orders` 只回 tenant_id = 7 的那幾列，query 本身不用再寫 WHERE。不過「這次是哪個 tenant」還是 application 設的。這一步漏掉的話，本機 PostgreSQL 17 跑出來是這樣：

- 這條連線從沒設過 `app.tenant_id`：query 報錯 `unrecognized configuration parameter "app.tenant_id"`，一列都不回。
- 用的是 `SET`（沒有 LOCAL），connection pool 把同一條連線交給下一個 request：上一個 request 設的 8 還留在連線上，這次替 tenant 7 查詢，回的卻是 tenant 8 的訂單。
- 用的是 `SET LOCAL`：交易一結束值就清掉，下一個交易忘了設，query 報錯 `invalid input syntax for type integer: ""`。

三種情況裡會讀到別人資料的只有第二種，所以每個交易開頭都用 `SET LOCAL` 設定。

第二行的 `FORCE` 也不能省。superuser 跟帶 `BYPASSRLS` 屬性的帳號一律不受 RLS 限制，table owner 預設也不受限，除非對這張表下了 FORCE。application 要是直接用建表的那個帳號連線，少了 FORCE，同樣的 `SELECT * FROM orders` 照樣回整張表，tenant 8、9 的訂單都在裡面。

MySQL 沒有 row 這一層，要先建一個帶 WHERE 的 view，再只把 view GRANT 出去。Supabase 的權限系統底層就是 RLS。

## 微服務隔離

每個服務用自己的 DB 帳號，只 GRANT 需要的表和操作。Order Service 的帳號只有 `orders`、`order_items` 的 SELECT 跟 INSERT，`payments` 表一個權限都沒有。攻擊者從 Order Service 的某個 SQL injection 進來，手上拿的是這組帳號，`SELECT * FROM payments` 回的是 permission denied，付款資料讀不到。

## Secret Management

DB 密碼不進 git，用 K8s Secrets、AWS Secrets Manager 或 Vault 管理。
