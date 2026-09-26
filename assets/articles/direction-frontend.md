---
title: "方向：前端系統設計"
slug: direction-frontend
subtitle: "同樣的方法論，換一台機器：使用者的瀏覽器。"
chapter: "extras"
tags: [meta, direction, frontend, radio]
date: 2026-07-03
related: [direction]
---

# 方向：前端系統設計

[方向](article://direction)那篇講後端怎麼學。前端是我最熟的一塊，學法一樣，差在程式跑在使用者的瀏覽器上。後端文章把因果追到磁碟跟共識演算法，前端文章追到 event loop、render pipeline 跟 network tab。

## 為什麼要分開一篇

「設計 Twitter」跟「設計一個 notification center 的前端」聽起來像同一種題目。實際上幾乎沒有共通點。

後端系統設計優化的是自己擁有的機器，DB 不夠用可以 shard，機器不夠可以再買。

前端系統設計優化的是一台不屬於自己的機器，也就是使用者的瀏覽器。這台機器的限制有這些：

- 只有一條 main thread
- 裝置好壞不知道
- 網路隨時會斷線
- cache 發出去就收不回來
- 使用者開了幾個 tab 不知道

## 答題框架：RADIO

這類題目通常照下面的順序回答：

- **R — Requirements exploration**：收斂範圍。功能邊界、規模、要不要離線、明確不做什麼。
- **A — Architecture**：元件圖。view、controller、client store、API layer，誰跟誰說話。
- **D — Data model**：client state 怎麼組織。normalized 還是 nested、server state 跟 UI state 分開放、cache 放哪一層。
- **I — Interface**：API 合約。endpoint 或 [WebSocket](chunk://websocket) event 的 schema、分頁游標、錯誤格式。
- **O — Optimizations**：深挖。效能、virtualization、race condition、a11y、離線。

RADIO 在前端設計題的用途，跟 STAR 在 behavioral 題一樣，都是給回答一個固定的順序。

## 題庫：經典四題

每題寫一篇。每題底下都有一個根本問題，我在真實專案裡都遇過。

| 題目 | 底下的根本問題 | 我在哪裡遇過 |
|---|---|---|
| Autocomplete | response 亂序回來。取消、debounce、打字中的過期資料 | 每一個做過的搜尋框 |
| Infinite scroll | DOM 跟不上節點數量。virtualization、list windowing、scroll anchoring | kubelens：820 個節點讓 DOM 畫面 freeze，被迫改 WebGL |
| Real-time dashboard | push 還是 pull、斷線重連、backpressure、資料一直灌進來時怎麼渲染 | kubelens 的 rollout status 走 WebSocket |
| Notification center | fan-in、未讀數、跨 tab 一致性、已讀狀態同步 | 部落格那篇 who-can-hear-this |

## 一手資料

讀蓋系統的人寫的設計文件，不讀教學文。

### React — RFCs

React 每個大功能都從一份 RFC（Request for Comments，公開的設計提案）開始，寫著動機、被否決的替代方案、trade-off。

- [reactjs/rfcs](https://github.com/reactjs/rfcs)
- Server Components 跟 Hooks 兩份值得從頭讀到尾：它們解釋功能出現之前，缺的是什麼。

### TanStack Query — 程式碼好讀的 client cache 設計

server-state cache 的參考實作：staleTime 跟 gcTime、structural sharing、invalidation。

- [TanStack/query](https://github.com/TanStack/query)

### 平台本身

- [HTML spec：event loops](https://html.spec.whatwg.org/multipage/webappapis.html#event-loops)：「main thread」這個詞的唯一權威定義。
- [Fetch spec](https://fetch.spec.whatwg.org)：`fetch()` 到收到 bytes 之間，瀏覽器實際做了什麼。
- [Chrome RenderingNG](https://developer.chrome.com/docs/chromium/renderingng)：render pipeline 的實際分層。

## 二手資料（當字典，不當課本）

| 來源 | 用途 |
|---|---|
| [GreatFrontEnd](https://www.greatfrontend.com) | RADIO 框架的出處，前端系統設計題庫裡最完整的 |
| [patterns.dev](https://www.patterns.dev) | rendering 跟 component pattern，附圖 |
| [yangshun/front-end-interview-handbook](https://github.com/yangshun/front-end-interview-handbook) | 深入前先過一遍詞彙 |

## 頭五篇

| 順序 | 文章 | 為什麼先寫這篇 |
|---|---|---|
| 1 | RADIO，以及前端系統設計為什麼是獨立學科 | 其他文章都掛在這個框架上 |
| 2 | Real-time dashboard | 離我做過的專案最近（kubelens）。先寫我會的，寫的過程找出我不會的 |
| 3 | Notification center | 把 who-can-hear-this 從機制延伸成系統 |
| 4 | Infinite scroll | 把 DOM 跟不上節點數量的故事完整講一次 |
| 5 | Autocomplete | 表面最小、race condition 密度最高，適合收尾 |
