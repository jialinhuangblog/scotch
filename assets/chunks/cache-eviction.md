---
title: "Cache Eviction"
slug: cache-eviction
brief: "LRU、LFU、TTL。記憶體有限，誰該被踢掉？"
date: 2026-06-12
updated: 2026-10-18
revisions: 2
---

# Cache Eviction

> cache 滿了，新資料要進來，該踢掉哪一筆？

## Eviction policy

cache 放在記憶體、空間有限，滿了就得挑一筆丟掉。挑哪一筆的規則叫 eviction policy。丟掉的要是等一下馬上又會被讀的 key，那次讀取就 miss，要回 DB 拿。

拿一個只放得下 3 筆的 cache 走一遍。依序讀商品 A、B、C，放滿了。接著再讀一次 A，然後讀 D。D 要進來，得丟一筆。

- **LRU（Least Recently Used）**：丟最久沒被碰的。A 剛被讀過，B 是最久沒碰的，丟 B。賭的是「最近用過的等下還會用」。最常用。
- **LFU（Least Frequently Used）**：丟用最少次的。A 讀了 2 次，B、C 各 1 次，B 跟 C 之間再看誰舊，一樣丟 B。cache 剩下 A(2)、C(1)、D(1)，D 剛進來所以計數是 1。接著再讀一次 C，C 變成 2；然後 E 要進來，這時計數最低的只有 D，丟 D。D 要是剛上熱搜的商品，下一次讀它就 miss，重新進來計數又是 1，下一輪還是它最低。賭的是「熱門的會一直熱門」，對剛熱起來的 key 不利。
- **TTL / 過期**：每筆設一個存活時間，例如 60 秒，到期自動清，不管滿不滿。
- **FIFO / random**：先進先出會丟 A，因為 A 最早進來，不管它剛被讀過；隨機丟就看運氣。簡單但不看冷熱。

像一個小冰箱，塞不下時，先丟最久沒動過的那盒（LRU）。

## 大範圍掃描讓 LRU 命中率下降

同一個放 3 筆的 cache 平常放著 A、B、C 三個熱門商品，命中率很高。這時有一支報表程式把全站 10,000 個商品從頭讀一遍，每個只讀一次。LRU 看每個新 key 都是「最近用過」，A、B、C 被前三個掃描的 key 換掉，之後每一筆都 miss。報表跑完，正常使用者回來讀 A，還是 miss，要回 DB。所以實務常用 LRU 跟 LFU 的混合。下面兩種都讓掃描的 key 進 cache，只是進不了放熱門資料的那一區。

ARC 把 cache 分成兩條 LRU list，只被讀過一次的 key 放 T1，讀過兩次以上的升到 T2。報表掃過的 10,000 個 key 每個只讀一次，所以只在 T1 裡輪替，A、B、C 早就在 T2，不會被換掉。W-TinyLFU（Caffeine 用的就是它）讓新 key 先進一個很小的 LRU window，被擠出 window 的時候，拿它的讀取次數跟主區裡下一個要被替換的那筆比，次數低的那筆丟掉。掃描的 key 都只讀過一次，次數低於 A、B、C，所以進不了主區。
