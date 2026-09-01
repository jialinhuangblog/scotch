---
title: "一條連線一個 process，挺耗能的但換來很多功能"
slug: pg-tradeoff
subtitle: "process per connection 比較重，但換來的是功能完整。MySQL 缺的那些功能，多半就是這個取捨的結果。"
tags: [postgresql, mysql, system-design-interview]
date: 2026-04-02
related: [db-connections, db-access-control]
---

# 一條連線一個 process，挺耗能的但換來很多功能

同一條 `SELECT * FROM orders WHERE id = 1`，丟給 PostgreSQL 和 MySQL，結果一樣。但背後發生的事不同。

---

## 設計分歧：process vs thread

100 條連線同時進來。

PostgreSQL 每收到一條連線，fork 一個新的 OS process。每個 process 有自己獨立的 address space，佔 5-10 MB RAM。100 條連線 = 100 個 process = 500 MB - 1 GB，光是連線就吃掉了。OS 要在 100 個 process 之間做 context switch，process 越多切越慢。

MySQL 每收到一條連線，開一個 thread。Thread 共用同一個 process 的 address space，每個只需要自己的 stack（幾百 KB）。100 條連線 = 100 個 thread，還在同一個 process 裡，context switch 比 process 間快很多。

所以 MySQL 開幾千條連線問題不大，PostgreSQL 開幾百條就需要 PgBouncer 做連線池。連線的代價和 PgBouncer 怎麼解，詳見 [連線不是免費的](db-connections)。

PostgreSQL 刻意選了 process 模型。每條連線獨立隔離，一條 crash 不會拉下其他連線。這比較吃資源，但也因此有空間做很多複雜功能。

其他資料庫怎麼選的：

| 資料庫 | 模型 | 備註 |
|---|---|---|
| PostgreSQL | process per connection | 隔離好，重 |
| MySQL | thread per connection | 輕，但隔離差 |
| Oracle | process（dedicated）或 shared server | 可選，預設 dedicated process |
| SQL Server | thread + fiber mode | 類似 MySQL，thread-based |
| SQLite | 單 process，無 server | 嵌入式，不算 client-server 架構 |

---

## 換來了哪些功能

以下每個功能，MySQL 要嘛沒有，要嘛很晚才加。PostgreSQL 從很早就有，因為 process 模型給了它更多空間做複雜的事。

### CTE（Common Table Expression）— 子查詢不用寫兩次

CTE 是 SQL 的「暫時命名子查詢」。用 `WITH ... AS (...)` 把一段查詢命名，後面可以重複引用。不是 table，不是 view，只活在那一次 query 裡。

想算「每個部門平均薪資高於公司整體平均的部門」。沒有 CTE 的話：

```sql
SELECT dept, avg_salary
FROM (SELECT dept, AVG(salary) AS avg_salary FROM employees GROUP BY dept) sub
WHERE avg_salary > (SELECT AVG(salary) FROM employees);
```

`AVG(salary)` 的邏輯出現兩次。改一個忘改另一個就出 bug。CTE 讓你命名一次，引用多次：

```sql
WITH dept_avg AS (
  SELECT dept, AVG(salary) AS avg_salary FROM employees GROUP BY dept
)
SELECT * FROM dept_avg
WHERE avg_salary > (SELECT AVG(avg_salary) FROM dept_avg);
```

MySQL 到 8.0（2018）才支援 CTE。之前只能用巢狀子查詢，或在 application 層自己算。

### Window Functions — 想看明細又想看統計

老闆要一張報表：每筆訂單的金額，旁邊顯示該客戶的累計消費。用 GROUP BY 的話，明細被壓成一行，看不到每筆訂單了。不用 GROUP BY 的話，算不出累計。

```sql
SELECT order_id, amount,
       SUM(amount) OVER (PARTITION BY customer_id ORDER BY created_at) AS running_total
FROM orders;
```

每筆訂單還是一行，旁邊多了累計值。明細和統計同時存在。

MySQL 同樣到 8.0 才支援。2018 之前的 MySQL 要用 correlated subquery 或 session variable hack 來繞，效能差、可讀性更差。

### JSONB — 欄位結構不固定

電商平台，手機有「螢幕尺寸、RAM」，衣服有「尺碼、顏色」。每個屬性都開一個 column 的話，表會有幾百個 column，大部分是 NULL。開一張 `product_attributes` 關聯表的話，每次查商品要 JOIN。

```sql
INSERT INTO products (name, attrs)
VALUES ('iPhone', '{"screen": "6.1", "ram": "8GB"}');

SELECT * FROM products WHERE attrs->>'ram' = '8GB';

CREATE INDEX ON products USING GIN (attrs);
```

一個 JSONB 欄位收不固定的部分，能查、能建 index。MySQL 5.7 加了 JSON type，但不支援 GIN index，查詢效能差很多。

### Partial Index — 整張表建 index 太浪費

orders 表一千萬筆，只有 pending 的需要頻繁查詢。對整張表建 index，99% 的 entry 是已完成的訂單，白佔空間、拖慢寫入。

```sql
CREATE INDEX ON orders (created_at) WHERE status = 'pending';
```

只索引 pending 的那幾千筆。Index 從幾 GB 縮到幾 MB。PostgreSQL 的 query planner 會自動判斷：query 的 WHERE 條件是不是 partial index 條件的子集，是就用，不是就不用。

MySQL 到現在都不支援 partial index。

### Array — 多對多關係太重

文章有多個 tag。正規做法是三張表：`articles`、`tags`、`article_tags`。查「有某個 tag 的文章」要 JOIN 兩張表。如果 tag 不需要獨立管理，array 就夠了：

```sql
tags TEXT[] = {'db', 'postgresql', 'rls'}

SELECT * FROM articles WHERE 'rls' = ANY(tags);
```

省掉一張關聯表和一次 JOIN。MySQL 不支援 array 欄位。

### Custom Types — 同一組欄位到處出現

`users` 表有 `home_city, home_zip`，`orders` 表有 `shipping_city, shipping_zip`，`warehouses` 表有 `location_city, location_zip`。三張表各寫兩個 column，改格式要改三個地方。

```sql
CREATE TYPE address AS (city TEXT, zip TEXT);

ALTER TABLE users ADD COLUMN home address;
ALTER TABLE orders ADD COLUMN shipping address;
```

改 address 的結構只改一個地方。MySQL 不支援 custom types。

---

## 內建 pub/sub：LISTEN/NOTIFY

大部分資料庫改了資料就結束了，外面的 client 不知道。要知道有沒有變，只能 polling。

PostgreSQL 內建了 pub/sub 機制。搭配 trigger，資料一變就能通知外面正在等的 client。

先定義通知 function，再綁 trigger 到 orders 表的 INSERT event：

```sql
-- 1. 定義 function：呼叫 pg_notify 發通知
CREATE FUNCTION notify_new_order() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('order_created', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. 綁 trigger：每次 INSERT 進 orders 表，自動呼叫上面的 function
CREATE TRIGGER on_order_insert
  AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION notify_new_order();
```

兩段分開讀：function 定義「做什麼」（發通知），trigger 定義「什麼時候做」（`AFTER INSERT ON orders`）。

Client 端開一條連線，`LISTEN order_created`，收到通知就做事。零 polling、幾乎零延遲。

### 限制

LISTEN 綁在那條連線上。連線斷了，訂閱就沒了，斷線期間的通知直接丟掉。沒有持久化、沒有重試、沒有 consumer group。

適合的場景：輕量即時通知。「有新訂單了，dashboard 更新一下。」漏掉一個通知頂多晚幾秒，下次 polling 補上。

不適合的場景：「這筆付款一定要被處理。」漏掉就是 bug。這時候需要 message queue（RabbitMQ、Kafka）或至少 Redis pub/sub 搭配持久化的 changelog。

生產環境常見的演進路徑：先用 LISTEN/NOTIFY 做即時通知 → 規模大了之後，改成 WAL logical replication + Redis pub/sub，讓通知跟 DB 連線解耦。

---

## RLS（Row-Level Security）— DB 層的權限控制

多租戶 SaaS，所有客戶的資料存在同一張表。靠 application 每條 query 加 `WHERE tenant_id = ?`，哪天有人忘了加，資料就外洩了。

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON orders
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id'));
```

不管 application 寫什麼 query，PostgreSQL 自動加 WHERE 條件。繞不過去。

MySQL 不支援 RLS。要做多租戶隔離，只能靠 application 層自律，或用 view 繞（但 view 不能強制所有 query 都走）。

RLS 的完整機制和 Supabase 怎麼用，詳見 [這張表你不能碰](db-access-control)。

---

## 決策路徑

每個團隊的痛點不同。選資料庫看的是「什麼時候會痛」。

**從 PostgreSQL 開始的團隊：** 需要 RLS、JSONB、CTE、Window Functions 其中任何一個的。多租戶 SaaS、資料結構混合固定和不固定欄位、報表查詢複雜。一開始就選 PostgreSQL，不用之後遷移。

**從 MySQL 開始的團隊：** 需求單純（CRUD + 基本 JOIN）、團隊熟悉 MySQL、連線量大但功能需求不高。MySQL 的 thread 模型在高連線量下比較輕鬆，不一定需要 connection pooler。

**什麼時候會後悔選了 MySQL：** 需求變複雜了。要做多租戶但沒有 RLS，要存 JSON 但沒有 GIN index，要寫複雜報表但 8.0 之前沒有 CTE 和 Window Functions。每個缺的功能都要在 application 層補，補著補著就發現自己在重造 PostgreSQL，哈哈。

**什麼時候會後悔選了 PostgreSQL：** 連線管理沒做好。幾百條連線直連，沒加 PgBouncer，CPU 花在 process context switch 而不是執行 query。或者 serverless 架構（Lambda 每個 invocation 開一條連線），瞬間幾千條連線打爆 `max_connections`。這些問題出在 infra 沒配好，功能本身沒有缺。

**後悔了怎麼辦：** MySQL → PostgreSQL 的遷移成本高（SQL 語法差異、stored procedure、權限模型都不同）。PostgreSQL 的連線問題加 PgBouncer 就解了，成本低得多。所以如果不確定未來需求，PostgreSQL 是比較安全的起點。
