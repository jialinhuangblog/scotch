---
title: "WebSocket 都有了，為什麼還需要 XMPP"
slug: why-xmpp
subtitle: "從一份聊天 spec 追下去：協議定義的是規則，不是管子。管子可以是 TCP、WebSocket，甚至 long polling。"
chapter: "realtime"
tags: [xmpp, websocket, long-polling, sse, chat, protocol]
date: 2026-07-24
related: [http-realtime-pushing, message-system-axes]
---

# WebSocket 都有了，為什麼還需要 XMPP

手上有一份即時訊息系統的 spec（來自一個真實系統，識別資訊都改掉了）。裡面是這樣的訊息：

```xml
<message
  to='table_08@conference.chat.acme.example'
  from='mina02@chat.acme.example/9f3a71'
  type='groupchat'
  xmlns='jabber:client'>
  <body>mina02 joined the room!!</body>
</message>
```

XML 定訊息格式，一條長連線收發。看起來就是「WebSocket + XML 做聊天」。那 XMPP（Extensible Messaging and Presence Protocol）這個名字到底多出了什麼？

## 自己蓋一個聊天室，缺的是什麼

假設不用 XMPP，自己蓋：開一條 [WebSocket](chunk://websocket)，訊息用 XML 或 JSON 傳。馬上就有一串問題要自己回答。登入的訊息長怎樣？加入房間要送什麼？對方怎麼知道我在線？斷線了誰通知誰？這些答案全部是自己發明的，寫死在自己的 code 裡。

結果這個 client 只能跟這個 server 講話。另一個團隊也蓋了一個「WebSocket + XML 的聊天室」，兩套系統還是無法互通。雖然都用 XML，元素名稱和收發順序是各自定的。

XMPP 把這些答案全部先寫成公開文件：連線後先交換什麼、怎麼登入（SASL，Simple Authentication and Security Layer）、地址長怎樣（`user@domain` 格式的 JID，Jabber ID）、訊息分哪三種、群聊怎麼運作。誰都可以照文件寫 server 或 client，不同人寫的 server 和 client 也能互相溝通。

最熟的參照物是 HTTP。沒有人會說「HTTP 是用 TCP 傳文字做網頁溝通」。HTTP 是協議：瀏覽器沒看過某個 web server 的 code，照樣能跟它要網頁，因為雙方照同一本規則書做。XMPP 跟 HTTP 同層、同性質，只是規則書的主題從「怎麼要資源」換成「怎麼傳訊息、報在線、進房間」。

這個設計有它的時代背景。XMPP 的前身 Jabber 誕生在 1999 年，當時的商用即時通訊軟體各自封閉，每換一個朋友圈就要多裝一套軟體。Jabber 的目標是做即時通訊界的 email：開放標準，任何人可以架 server，不同 domain 的 server 互相投遞。XMPP 的很多設計都來自這個目標：XML 是當年的通用交換格式，JID 長得像 email 地址，路由設計成聯邦式。

## 「協議」具體定義了什麼

連線上流動的每個獨立 XML 單位叫 stanza，總共三種。`<message>` 傳訊息，`<presence>` 報狀態，`<iq>`（Info/Query）問答。JS 圈的 XMPP library 有一個就直接叫 stanza，名字從這裡來。

「規則書」還是太抽象。拆開看，一個協議是格式加上時序、狀態、語意。後三個才是跟「payload 定義」的差別。

**時序**。連上後必須照順序走：開 XML stream、SASL 認證、綁 resource、送 presence。順序錯，server 直接拒絕。

**狀態**。client 送出 `<presence/>` 之後，server 的內部狀態改變了：把這個帳號標記為在線，開始把給它的訊息往這條連線投遞。

**語意**。`<iq>` 規定必須一問一答、id 要對得上；`type='groupchat'` 送到房間地址，server 會複製給房間裡所有人；`type='chat'` 只給一個人。協議規定了 server 收到之後必須做什麼。

HTTP 也一樣：GET 必須冪等、304 要走 cache。

## 它跑在什麼上面

XMPP 是應用層協議，底下的傳輸管道可以換。條件只有一個：能把 bytes 雙向送到對面。

```text
XMPP（不變：身分、在線、房間、投遞語意）
  ├─ 裸 TCP        天生雙向。native app 和後端服務走這裡
  ├─ WebSocket     握手借 HTTP 升級，之後真雙向。瀏覽器走這裡
  └─ BOSH          全程 HTTP，用 long polling 模擬雙向。
                   WebSocket 普及前瀏覽器的唯一解，現在是遺產
```

BOSH（Bidirectional-streams Over Synchronous HTTP）回答了一個容易搞混的問題：XMPP 跟 [long polling](chunk://long-polling) 是不是同一類東西。不是。XMPP 可以跑在 long polling 上面：

```text
client                                  server
  │  POST /http-bind                      │
  │  body: <body…><presence/></body>      │  stanza 塞在 HTTP body 裡
  │──────────────────────────────────────>│
  │        （沒新訊息就先不回…）             │  hold 住這個 request
  │  200 OK                               │
  │  body: <body><message …/></body>      │  有訊息了才回
  │<──────────────────────────────────────│
  │  馬上再 POST 下一發（回到頂端循環）       │
```

XMPP 能跑在 long polling 上，兩者就不是同一類。long polling 回答的是「server 怎麼把資料送到 client」，只是管道層的技巧；XMPP 回答的是「這個人是誰、訊息給誰、什麼是房間、誰在線」，底下用哪種管道都可以。[之前整理過的那條鏈](article://http-realtime-pushing)（Polling、Long Polling、SSE、WebSocket）整條都在管道層；XMPP 在那條鏈的上面一層。應用層疊應用層很正常：gRPC 跑在 HTTP/2 上，DNS over HTTPS 連查詢都裝進 HTTPS 裡送。

順著問：[SSE](chunk://sse) 能不能載 XMPP？單獨不行。SSE 只有 server 到 client 一個方向，沒有 client 到 server 的路。硬要拼可以用 SSE 配 HTTP POST 湊成雙向，協議層面沒有規定不行，但現實中沒有這個標準。它只改善了 BOSH 的一半（下行不用 hold 了再重問），上行照樣每則一個 POST、每次多送一份 header；而它普及的年代 WebSocket 也普及了，一條連線就能雙向傳輸。比 BOSH 晚出現、又只改善下行，所以沒有人為它寫規格。

| 管道 | 雙向 | 連線長開 | 每則的額外開銷 |
|---|---|---|---|
| 裸 TCP | 是 | 是 | 小 |
| WebSocket | 是 | 是 | 小 |
| BOSH | 模擬的 | 模擬的 | 大，每一輪都要再送一次 HTTP header |
| SSE 單獨 | 否，只有下行 | 下行是 | 下行小，沒有上行 |
| SSE + POST | 兩條連線湊的 | 只有下行是 | 上行大，每則一個 POST |

## 人就在房間裡，為什麼訊息還要寫地址

spec 裡每則訊息都帶完整地址（to、from）。直覺上很怪：人都已經在房間裡了，何必每句話都寫收件人？

但這個直覺的前提不對。沒有「房間的連線」，只有「每個使用者自己的連線」。房間是 server 上的物件，不是一條大家共用的管道。一個使用者加入的三個房間、五個私聊，全部訊息混在他那一條 stream 進出。所以：

- 出去的訊息要寫 `to`，因為 server 收到時只知道「這是 mina02 的連線傳來的東西」。不寫 `to`，它不知道這句要給哪個房間，還是要私訊給誰。
- 進來的訊息要帶 `from`（房間地址加暱稱），因為收進來的也是同一條連線上混著的一堆訊息，client 靠這欄把訊息分進正確的聊天視窗。

類比：在一棟大樓租三個房間開會，大樓只有一個收發室，所有信送進同一個信箱。每封信不寫「來自 302 會議室」就沒辦法分堆。不是因為別人也收得到，是因為自己的信全部混在一起。

同樣的設計到處都是：[TCP](chunk://tcp) 連線建好了，每個封包還是帶 port；[HTTP/2](chunk://http2) 一條連線上每個 frame 還是帶 stream ID。一條連線多路複用，每個單位就必須自帶「我屬於哪一路」。

那地址寫得這麼詳細，不在房間裡的人是不是也收得到？不會，因為收不收是 server 決定的，不是 client 看地址過濾。XMPP 不是廣播介質。房間的訊息，server 只寫進當下在房間裡的人的連線；不在房間，那則訊息根本不會出現在那個人的連線上。地址是路由和分流用的 metadata，存取控制在 server 手上。

### 房間是什麼：MUC

XMPP 核心協議只定義一對一聊天。「房間」是擴充規格 MUC（Multi-User Chat，XEP-0045）補的：

- 房間是 server 上的一個物件，有自己的地址。`table_08@conference.chat.acme.example` 的 domain 是 conference 子服務，跟一般帳號區隔。
- 進房等於對房間送一個 presence，帶上暱稱。之後就是這個房間的 occupant，房間的訊息開始投遞到這條連線；退房或斷線就從名單消失。
- 對房間發言等於送 `type='groupchat'` 的訊息給房間地址，server 複製給所有 occupant，包含發言者自己那份（reflection）。

## 實際接起來長什麼樣

兩端都用現成的。server 端起一個 ejabberd（或 Openfire、Prosody），設定好 domain。它同時接受幾種連線方式：標準的 client 連線走 TCP port 5222（RFC 6120 定的預設值），瀏覽器走 WebSocket，掛在 server 的 HTTP listener 上，port 和路徑各家自己設定。不管從哪一種連進來，帳號和房間是同一套。

瀏覽器端拿現成 library：Strophe.js 直接操作 XML，最能看清協議原文；stanza 把一切包成 JSON 風格的 API；Converse.js 連聊天 UI 都附（它底下就是 Strophe）。之後的程式就是 connect 加一個收訊息的 callback。

連起來的順序：

```text
瀏覽器 → XMPP server

1. HTTPS 握手 + Upgrade: websocket
2. 開 XML stream
3. SASL 認證
4. 綁 resource（同帳號多分頁靠這個區分）
5. 送 presence，等於「我上線了」
6. 對房間 JID 送 presence，等於進房
7. 之後連線一直開著，stanza 雙向流動
```

第 1 步是 WebSocket 自己的事，第 2 步起才是 XMPP。對應前面的分層：管子先接好，然後在管子裡照規則書對話。

圖上最後一行是連線一直開著。從此收到的每則訊息，都不是哪個 request 的 response。連線上沒有一問一答的配對（`<iq>` 除外），送出去的和收進來的 stanza 是兩串獨立的流，各走各的方向。server 有東西就直接寫進連線；client 這端是 socket 的 read 事件觸發之後，parse、看 `from`、分視窗。在房間裡發言後收到自己那份訊息，也不是 response，是 server 對全房間投遞時，發言者身為 occupant 分到的一份。

## server 到底在做什麼

XMPP server 是郵局。看信封（to、from）決定送到哪，不拆信讀內容。

這份 spec 在標準訊息裡塞了自訂元素：

```xml
<message
  to='mina02@chat.acme.example'
  from='ops_bot@chat.acme.example'
  type='chat'
  xmlns='jabber:client'>
  <event type='mute'
    start_time='2026-07-01 00:00:00'
    end_time='2026-12-31 00:00:00'/>
  <body>This user should be muted.</body>
</message>
```

`<event type='mute'>` 是這個系統自己發明的名字，XMPP 規則書裡沒有。自訂元素該掛一個自己的 namespace，才不會跟別人的 `<event>` 撞名；上面這個例子省略了，下面的程式補成 `urn:example:chat`。

一次禁言牽涉四個角色，下面各列一段程式。

**版主的瀏覽器**：普通網頁，跟 XMPP 無關。

```js
await fetch('/api/rooms/table_08/mute', {
  method: 'POST',
  body: JSON.stringify({ user: 'mina02', until: '2026-12-31T00:00:00Z' })
})
```

**自家後端**：判斷禁誰、禁多久。它同時用 `ops_bot` 這個帳號連上 XMPP server，以 moderator 的身分待在房間裡，不然下面那個 iq 會被退回 `<not-allowed/>`。stanza 直接寫成字串是為了看得清楚，實際上 library 給的是 builder。

```js
app.post('/api/rooms/:room/mute', async (req, res) => {
  const { user, until } = req.body
  requireModerator(req.session.user, req.params.room)
  await db.mutes.upsert({ room: req.params.room, user, until })   // 真相存在自家 DB

  // 一、叫 XMPP server 真的不讓他發言（XEP-0045 §8.4）
  await opsBot.send(`
    <iq to='table_08@conference.chat.acme.example' type='set' id='voice2'>
      <query xmlns='http://jabber.org/protocol/muc#admin'>
        <item nick='mina02' role='visitor'/>
      </query>
    </iq>`)

  // 二、通知他，讓畫面有反應
  await opsBot.send(`
    <message to='mina02@chat.acme.example' type='chat'>
      <event xmlns='urn:example:chat' type='mute' end_time='${until}'/>
      <body>You have been muted until ${until}.</body>
    </message>`)

  res.sendStatus(204)
})
```

**XMPP server**：這段不用自己寫。ejabberd 是 Erlang 寫的，下面是照 XEP-0045 的規定改寫成 JS 的 pseudo code，用來看它收到那兩則 stanza 各做什麼判斷。

```js
onMucAdminIq(iq) {                                    // §8.4
  const room = rooms[iq.to]
  const item = iq.query.item                          // <item nick='…' role='visitor'/>
  if (room.roleOf(iq.from) !== 'moderator') return reply(error('not-allowed'))
  room.occupants[item.nick].role = item.role
  reply(result())
  broadcastPresence(room, item.nick, item.role)       // 房裡每個人都收到這則 presence
}

onGroupchatMessage(msg) {                             // §7.4
  const room = rooms[msg.to]
  if (room.roleOf(msg.from) === 'visitor') return reply(error('forbidden'))
  for (const o of room.occupants) deliver(o.jid, msg)  // 被禁言的人到不了這行
}

onChatMessage(msg) {
  route(msg.to, msg)      // 只看 to。<event> 裡面是什麼，不解析也不在乎
}
```

**mina02 的瀏覽器**：用 Strophe.js 寫的自家網頁。

```js
conn.addHandler(onMuteEvent, 'urn:example:chat', 'message')

function onMuteEvent(stanza) {
  const ev = stanza.querySelector('event')
  if (ev.getAttribute('type') === 'mute') {
    ui.inputBox.disabled = true
    ui.banner.show(`禁言到 ${ev.getAttribute('end_time')}`)
  }
  return true
}
```

mina02 改用 Gajim 這種別人寫的 XMPP 軟體登入同一個帳號，一樣連得上，因為連線和登入都走標準。差別在它的 handler 表裡沒有 `urn:example:chat`。Gajim 是 Python 寫的，下面同樣是 pseudo code：

```js
function onMessage(stanza) {
  const body = stanza.querySelector('body')
  if (body) ui.appendBubble(body.textContent)    // <event> 沒人接，就這樣過去了
}
```

他的輸入框不會變灰，只看到一句英文。但他打字送出去照樣進不了房間，因為拒絕他的是 server 上那行 `role === 'visitor'`，換哪個 client 都一樣。決策在自家 DB，執行在 XMPP server，那個自訂 event 只是通知。

「server 保持笨、邏輯放兩端」是預設。當商業規則必須在訊息路徑上生效，才把一小塊邏輯放進 server：用它內建的 role，或規則太特殊的時候寫一個 plugin。

## 跟 message queue 差在哪

「broker 只看信封不拆內容、producer 丟進來、broker 決定給誰」，這個描述套在 Kafka 或 RabbitMQ 上一字不用改。XMPP server 跟 message queue 確實是同一族。拿[訊息系統的四軸](article://message-system-axes)來切，差異就出來：

| 軸 | Message queue | XMPP server |
|---|---|---|
| 哪一層 | 後端服務之間 | server 到終端使用者的裝置 |
| 收件人 | 「任何一個 worker」：十個 consumer 誰有空誰拿，訊息是待分配的工作 | 「就是這個人」：給 mina02 的禁言通知不能被別人領走，地址是身分 |
| 存法 | 存起來是核心：consumer 掛了訊息等著、可重讀 | 即時投遞是核心：人在線就推，離線訊息是後來補上的擴充 |
| 連線 | consumer 是機房裡的服務，連線穩定 | 對面是手機和瀏覽器，會斷線、換網路、開三個分頁 |

Message queue 解耦服務，預設 consumer 不一定在，力氣花在持久化、重試、consumer group。XMPP 連接人，預設人現在就在線上等，力氣花在 presence、帳號認證、同一人多裝置。

同一個系統常常兩個都要。營運後台到後端服務之間可能有一條 queue（服務對服務）；後端到玩家手機這最後一段，才輪到 XMPP（server 對人）。同一則「禁言」，前半段是待處理的工作，後半段是給人的通知。

## 選型：什麼時候輪得到 XMPP

情境：遊戲平台要做房間聊天。需求攤開：群聊房間、一對一、禁言、guest 免註冊登入、營運端要能對房間廣播事件。前端是瀏覽器，同時在線幾萬人。

常見的決策路線這樣走。第一步幾乎都是裸 WebSocket 加 JSON，因為最快看到東西動：訊息格式自己定，一個 room Map 管房間。到這裡都很順。

然後需求一項一項來：在線狀態（自己做心跳和廣播）、離線訊息（自己做儲存和補發）、多裝置（同帳號開兩個分頁，訊息要都到）、禁言（自己做權限模型）。每一項都是 XMPP 規則書裡現成的章節。自己做，等於把 XEP 重新發明一遍，而且沒有文件。

換 XMPP 的話：起一個現成 server、前端接一個現成 library（前面那節的組合），登入、房間、路由、在線都有現成實作。自訂需求用 `<event>` 擴充塞進標準訊息。開頭那份 spec 只有幾頁，就是因為其他事規則書和現成 server 都處理完了，只需要寫「我們在標準上加了什麼」。

什麼時候會後悔：

- **XML 的開銷開始明顯。** 行動網路上每則訊息的 byte 數和電量，XML 比精簡的二進位格式差一截。訊息量大到頻寬成本變得顯著，就是重新評估的時候。
- **客製多到標準裝不下。** 發現大部分功能都在寫 plugin、繞協議，而標準帶來的互通性又用不到（client 全是自家的），那 XMPP 剩下的價值只是現成的連線管理。裸 WebSocket 配一個好的框架可能更直接。
- **團隊沒人想學 XEP。** 協議的學習曲線是整套規則書。今天重選，開放協議這條路上還有 Matrix（2014 年起的開放標準，RESTful HTTP 加 JSON，端到端加密內建，房間狀態在 server 之間同步）；只要推事件、不需要完整聊天語意的話，MQTT 這類輕量 pub/sub 協議更省；或者直接買託管聊天服務，SDK 接上就有，換來的是按量計費和資料在別人手上。

反過來，什麼時候 XMPP 依然是對的：需求跟「人與人即時通訊」的標準模型重合度高（房間、在線、多裝置、禁言），又想自己持有資料和 server。重合的部分越多，規則書和現成 server 白送的就越多，自己要寫的就只剩那幾頁 spec。
