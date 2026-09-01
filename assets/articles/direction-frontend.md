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

[方向](article://direction)那篇講後端的腿怎麼長。這篇畫另一條腿的地圖，也是我最深的一條：前端。方法不變，機器換了。後端文章把因果追到磁碟跟共識演算法，前端文章把因果追到 event loop、render pipeline、跟 network tab。

## 為什麼要分開一篇

「設計 Twitter」跟「設計一個 notification center 的前端」聽起來像同一種題目。實際上幾乎沒有共通點。

後端系統設計優化的是你擁有的機器。DB 撐不住就 shard，寫入太多就加 queue，機器不夠就買。

前端系統設計優化的是一台不屬於你的機器：使用者的瀏覽器。只有一條 main thread。裝置好壞未知。網路隨時會斷。cache 發出去就收不回來。使用者開了幾個 tab 你不知道。每個設計決策都是在跟這台機器談條件。

## 答題框架：RADIO

這類題目的標準走法，五站，照順序：

- **R — Requirements exploration**：收斂範圍。功能邊界、規模、要不要離線、明確不做什麼。
- **A — Architecture**：元件圖。view、controller、client store、API layer，誰跟誰說話。
- **D — Data model**：client state 長什麼形狀。normalized 還是 nested、server state 跟 UI state 分開放、cache 放哪一層。
- **I — Interface**：API 合約。endpoint 或 [WebSocket](chunk://websocket) event 的 schema、分頁游標、錯誤格式。
- **O — Optimizations**：深挖。效能、virtualization、race condition、a11y、離線。

RADIO 跟 STAR 是平行的東西：STAR 給 behavioral 題一個骨架，RADIO 給前端設計題一個骨架。框架跟著題型走，題目是題型底下的實例。

## 題庫：經典四題

一題一篇。每題底下藏著一個根本問題，而且我在真實專案裡都撞過一次。

| 題目 | 底下的根本問題 | 我在哪裡撞過 |
|---|---|---|
| Autocomplete | response 亂序回來。取消、debounce、打字中的過期資料 | 每一個做過的搜尋框 |
| Infinite scroll | DOM 撐不住規模。virtualization、list windowing、scroll anchoring | kubelens：820 個節點讓 DOM 凍住，被迫改 WebGL |
| Real-time dashboard | push 還是 pull、斷線重連、backpressure、資料一直灌進來時怎麼渲染 | kubelens 的 rollout status 走 WebSocket |
| Notification center | fan-in、未讀數、跨 tab 一致性、已讀狀態同步 | 部落格那篇 who-can-hear-this |

## 一手資料

讀蓋系統的人寫的設計文件，不讀教學文。

### React — RFCs

React 每個大功能都從一份 RFC（Request for Comments，公開的設計提案）開始，寫著動機、被否決的替代方案、trade-off。

- [reactjs/rfcs](https://github.com/reactjs/rfcs)
- Server Components 跟 Hooks 兩份值得從頭讀到尾：它們解釋功能出現之前，缺的是什麼。

### TanStack Query — 讀得動的 client cache 設計

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
| 2 | Real-time dashboard | 離我做過的東西最近（kubelens）。先寫我會的，寫的過程找出我不會的 |
| 3 | Notification center | 把 who-can-hear-this 從機制延伸成系統 |
| 4 | Infinite scroll | 把 DOM 撐不住規模的故事完整講一次 |
| 5 | Autocomplete | 表面最小、race condition 密度最高，適合收尾 |
