---
title: "CQRS"
slug: cqrs
brief: "讀和寫用不同的 model。大部分系統不需要，但對的場景下，沒什麼更好的替代方案。"
article: scaling-first-move
date: 2026-04-07
updated: 2026-10-18
revisions: 2
---

# CQRS

Command Query Responsibility Segregation。寫入跟讀取用不同的 model：寫入用的資料結構照「怎麼改才不會出錯」設計，讀取用的照「畫面要什麼」設計。兩個 model 可以在同一個資料庫裡，也可以分開放；下面的例子是在同一個 DB 裡多一張 table 當 query model。

## 為什麼要分

先看沒分的時候長什麼樣。電商的訂單存在三張正規化的表，orders、order_items、products。老闆要看的「每月各類商品銷售額」，每次打開報表頁都現算，三張表 JOIN 起來，orders 有 2000 萬筆，掃完加總要 8 秒。同一時間結帳的寫入也在這三張表上，報表的大 JOIN 把 DB 的 CPU 佔滿，結帳跟著變慢。

兩邊要的本來就不一樣。寫入要正規化，一個商品名稱只存一份，改價格只改一個地方。讀取要的是一行就能回答問題的表，不想 JOIN。

CQRS 的做法是多一張 monthly_sales_summary，一列就是「2026 年 9 月、電子產品、1,240,000 元」。報表頁只讀這張表，一筆 SELECT，20 毫秒。這張表怎麼跟上寫入？結帳寫進 orders 之後發一個 OrderPlaced 事件丟進 message queue，一個 consumer 收到，就把對應月份、對應類別那一列加上這筆金額。

```text
寫入 → Command Model（orders + order_items + products）
         └→ OrderPlaced 事件 → queue → consumer
讀取 → Query Model（monthly_sales_summary）
```

## 代價

事件是非同步送的，結帳成功到 summary 表加上去，中間可能差幾秒，這幾秒內報表少算一筆，這就是 eventual consistency。consumer 掛掉一小時，報表就少算一小時，而且 orders 表看起來完全正常，要兩邊對過才找得到差在哪。schema 也變成兩套要維護，orders 加一個欄位，summary 可能也要跟著改。

## 什麼時候值得

讀的 schema 跟寫的 schema 差很多、讀寫的量差好幾個數量級、或是系統本來就在發事件，query model 訂閱既有事件就能更新。大部分 CRUD 系統用不到，一張表加幾個 index 就夠。上面那個 8 秒的報表其實也還不一定要用：月報的數字不常變，先加 index、或把結果 cache 幾分鐘，報表就不會每次打開都跟結帳搶 CPU。拿它當例子，是因為它最容易看出兩邊為什麼要不同的 model。

monthly_sales_summary 也可以只是一張普通的彙總表，例如 PostgreSQL 的 materialized view。差在更新的方式：REFRESH MATERIALIZED VIEW 每次都把整個 JOIN 重跑一遍，還是在同一個 DB 上跟結帳搶 CPU；CQRS 的 consumer 每來一筆訂單，只在一列上加一筆金額。這張表變成 CQRS 的一部分，是在 code 分成兩條路的時候：寫入只碰 command model，讀取只碰 query model，兩邊靠事件同步。
