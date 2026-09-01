---
title: "DB Access Control"
slug: db-access-control
brief: "誰能碰哪些資料，從 table 到 row，各 DB 控制的細度不一樣。"
article: db-access-control
date: 2026-03-31
updated: 2026-07-20
revisions: 1
---

# DB Access Control

SQL 的 DCL（Data Control Language）：GRANT 和 REVOKE，決定誰能碰什麼。

## 權限粒度

| 粒度 | PostgreSQL | MySQL | MongoDB | DynamoDB |
|---|---|---|---|---|
| Database | GRANT CONNECT | GRANT ALL ON db | 有 | IAM policy |
| Table | GRANT SELECT/INSERT/... | GRANT SELECT/INSERT/... | db 層控制 | IAM per table |
| Column | GRANT SELECT(col) | GRANT SELECT(col) | 不支援 | 不支援 |
| Row | Row-Level Security | 不支援（用 view 繞） | 不支援 | IAM conditions |

PostgreSQL 的 RLS 可以讓不同 user 只看到屬於自己的 row，DB 層強制過濾，application 繞不過去。Supabase 的權限系統底層就是 RLS。

## 微服務隔離

每個服務用自己的 DB 帳號，只 GRANT 需要的表和操作。就算有人攻進 Order Service，它那組 DB 帳號根本沒給 payments 表的權限，也就無法再繼續下去。

## Secret Management

DB 密碼不進 git，用 K8s Secrets、AWS Secrets Manager 或 Vault 管理。
