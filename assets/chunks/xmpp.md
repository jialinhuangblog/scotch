---
title: "XMPP"
slug: xmpp
brief: "聊天的應用層協議：定義身分、在線、房間與投遞語意。TCP、WebSocket、BOSH 都能當它的管子。"
date: 2026-07-24
updated: 2026-08-08
revisions: 1
article: why-xmpp
---

# XMPP

> 自己用 WebSocket 蓋聊天室，登入、房間、在線狀態全要自己發明，而且只有自家 client 看得懂。有沒有現成的規則書？

## 協議，不是實作

XMPP（Extensible Messaging and Presence Protocol）跟 HTTP 同一層：一份公開的規則書，定義訊息長怎樣、連線後照什麼順序對話、server 收到之後必須做什麼。照規則書寫的 client 和 server 互相認識——所以聊天 server 用裝的（ejabberd、Openfire），不用寫，就像做網站裝 nginx 不用自己寫 web server。

## 三種 stanza

連線上送的每個獨立 XML 單位叫 stanza，共三種：

| stanza | 做什麼 | 例子 |
|---|---|---|
| `<message>` | 送出去就算數，server 不回你 | `<message to='mina02@chat.example' type='chat'><body>在嗎</body></message>`<br>`type='groupchat'` 就是發到房間 |
| `<presence>` | 報自己的狀態，server 廣播給訂閱你的人 | `<presence><show>away</show><status>吃飯中</status></presence>`<br>進房間也是送 presence 到房間的 JID |
| `<iq>` | 一問一答，`id` 要對得上才知道誰回誰 | 問：`<iq type='get' id='r1'><query xmlns='jabber:iq:roster'/></iq>`<br>答：`<iq type='result' id='r1'>` 帶回好友清單 |

地址叫 JID（Jabber ID），長得像 email：`mina02@chat.example`。房間也是一個 JID，掛在 conference 子服務下。群聊由擴充規格 MUC（Multi-User Chat，XEP-0045）定義：房間是 server 上的物件，進房送 presence，發言送 groupchat，server 複製給房間裡每個人。

## XMPP 跑在什麼之上

XMPP 的規則書只寫到應用層：stanza 長怎樣、server 收到要做什麼。底下用什麼把這些 XML 送到對面，規則書沒寫，能雙向送 bytes 就行。

```text
XMPP
 ├─ 裸 TCP      native app、後端服務
 ├─ WebSocket   瀏覽器
 └─ BOSH        全程 HTTP，用 long polling 模擬雙向（WebSocket 前的遺產）
```

所以「XMPP 是不是基於 WebSocket」問反了：XMPP 比 WebSocket 早十年，WebSocket 只是它後來多的一種載法。
