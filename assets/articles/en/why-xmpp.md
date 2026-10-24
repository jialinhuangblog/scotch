---
title: "We already have WebSocket. Why do we still need XMPP?"
slug: why-xmpp
subtitle: "Following one chat spec down: a protocol defines the rules, not the pipe. The pipe can be TCP, WebSocket, or even long polling."
chapter: "realtime"
tags: [xmpp, websocket, long-polling, sse, chat, protocol]
date: 2026-07-24
related: [http-realtime-pushing, message-system-axes]
---

# We already have WebSocket. Why do we still need XMPP?

I have a spec for a realtime messaging system (from a real system, with the identifying details changed). The messages in it look like this:

```xml
<message
  to='table_08@conference.chat.acme.example'
  from='mina02@chat.acme.example/9f3a71'
  type='groupchat'
  xmlns='jabber:client'>
  <body>mina02 joined the room!!</body>
</message>
```

XML defines the message format, and one long-lived connection sends and receives. It looks like "WebSocket + XML for chat". So what does the name XMPP (Extensible Messaging and Presence Protocol) actually add?

## Build a chat room yourself, and see what is missing

Suppose you skip XMPP and build it yourself: open a [WebSocket](chunk://websocket) and send messages as XML or JSON. A string of questions appears right away, and you have to answer every one. What does the login message look like? What do you send to join a room? How does the other side know I am online? When a connection drops, who notifies whom? Every answer is your own invention, written into your own code.

The result: this client can only talk to this server. Another team builds its own "WebSocket + XML chat room", and the two systems still cannot talk to each other. Both use XML, but the element names and the order of exchange were each decided separately.

XMPP writes all of these answers down in advance, as public documents: what to exchange first after connecting, how to log in (SASL, Simple Authentication and Security Layer), what an address looks like (a JID, Jabber ID, in `user@domain` form), the three kinds of messages, how group chat works. Anyone can write a server or a client from the documents, and a server and a client written by different people can talk to each other.

The most familiar reference point is HTTP. Nobody says "HTTP is sending text over TCP to talk to web pages". HTTP is a protocol: a browser has never seen a given web server's code, yet it can ask that server for a page, because both sides follow the same rulebook. XMPP sits at the same layer as HTTP and is the same kind of thing. Only the subject of the rulebook changes, from "how to request a resource" to "how to send messages, report presence, and enter rooms".

This design has its historical context. Jabber, the predecessor of XMPP, was born in 1999. Commercial instant messaging software at the time was closed, each product to itself, and every new circle of friends meant installing one more program. Jabber's goal was to be the email of instant messaging: an open standard, anyone can run a server, and servers on different domains deliver to each other. Much of XMPP's design comes from that goal: XML was the general exchange format of the day, a JID looks like an email address, and routing is federated.

## What a "protocol" actually defines

Each independent XML unit flowing over the connection is called a stanza. There are three kinds. `<message>` carries messages, `<presence>` reports status, `<iq>` (Info/Query) is question and answer. One of the XMPP libraries in the JS world is simply named stanza; the name comes from here.

"Rulebook" is still too abstract. Taken apart, a protocol is format plus sequence, state, and semantics. The last three are what separate it from a "payload definition".

**Sequence**. After connecting, the steps must run in order: open the XML stream, SASL authentication, bind a resource, send presence. Get the order wrong and the server rejects the connection.

**State**. After the client sends `<presence/>`, the server's internal state changes: it marks this account as online and starts delivering messages addressed to it down this connection.

**Semantics**. `<iq>` requires one answer per question, with matching ids. `type='groupchat'` sent to a room address makes the server copy it to everyone in the room. `type='chat'` goes to one person only. The protocol specifies what the server must do after receiving each one.

HTTP is the same: GET must be idempotent, and 304 means use the cache.

## What it runs on

XMPP is an application layer protocol. The transport pipe underneath can be swapped. There is only one requirement: it must carry bytes in both directions to the other side.

```text
XMPP (unchanged: identity, presence, rooms, delivery semantics)
  ├─ raw TCP       two-way by nature. Native apps and backend services go here
  ├─ WebSocket     the handshake borrows an HTTP upgrade, then truly two-way. Browsers go here
  └─ BOSH          HTTP all the way, long polling simulates two-way.
                   The only browser option before WebSocket spread; now legacy
```

BOSH (Bidirectional-streams Over Synchronous HTTP) answers a question that is easy to confuse: are XMPP and [long polling](chunk://long-polling) the same kind of thing? No. XMPP can run on top of long polling:

```text
client                                  server
  │  POST /http-bind                      │
  │  body: <body…><presence/></body>      │  stanza packed inside the HTTP body
  │──────────────────────────────────────>│
  │        (nothing new, no reply yet…)   │  hold this request
  │  200 OK                               │
  │  body: <body><message …/></body>      │  reply only once a message exists
  │<──────────────────────────────────────│
  │  POST the next one right away (loop)  │
```

Since XMPP can run on long polling, the two are not the same kind of thing. Long polling answers "how does the server get data to the client"; it is a technique at the pipe layer. XMPP answers "who is this person, who is the message for, what is a room, who is online", and any pipe underneath will do. [The chain covered earlier](article://http-realtime-pushing) (Polling, Long Polling, SSE, WebSocket) sits entirely at the pipe layer. XMPP is one layer above that chain. Stacking one application layer protocol on another is normal: gRPC runs on HTTP/2, and DNS over HTTPS wraps even DNS queries inside HTTPS.

The next question: can [SSE](chunk://sse) carry XMPP? Not on its own. SSE only goes from server to client; there is no path from client to server. You could force it by pairing SSE with HTTP POST to assemble a two-way channel. Nothing at the protocol level forbids it, but no such standard exists in practice. It improves only half of BOSH (the downstream no longer has to hold and ask again), while the upstream still costs one POST per message and one extra set of headers each time. And by the time SSE spread, WebSocket had spread too, and one connection carried both directions. It came later than BOSH and improved only the downstream, so nobody wrote a spec for it.

| Pipe | Two-way | Connection stays open | Extra cost per message |
|---|---|---|---|
| raw TCP | yes | yes | small |
| WebSocket | yes | yes | small |
| BOSH | simulated | simulated | large, every round sends the HTTP headers again |
| SSE alone | no, downstream only | downstream yes | downstream small, no upstream |
| SSE + POST | assembled from two connections | downstream only | upstream large, one POST per message |

## The person is already in the room, so why does every message carry an address

Every message in the spec carries a full address (to, from). Intuitively that is odd: the person is already in the room, so why write a recipient on every line?

But the premise behind that intuition is wrong. There is no "room connection", only "each user's own connection". A room is an object on the server, not a pipe everyone shares. The three rooms and five private chats a user has joined all flow in and out mixed together on that one stream. So:

- Outgoing messages need `to`, because when the server receives one, all it knows is "this came in on mina02's connection". Without `to`, it cannot tell which room this line is for, or whether it is a private message, and to whom.
- Incoming messages need `from` (room address plus nickname), because what comes in is also a pile of messages mixed on the same connection. The client uses this field to sort each message into the right chat window.

An analogy: you rent three rooms in one building for meetings. The building has a single mail room, and every letter lands in the same mailbox. Without "from meeting room 302" on each letter, there is no way to sort them into piles. Not because other people could also receive them, but because all your own letters are mixed together.

The same design is everywhere: a [TCP](chunk://tcp) connection is established, yet every packet still carries a port. On one [HTTP/2](chunk://http2) connection, every frame still carries a stream ID. When one connection is multiplexed, each unit has to carry "which lane I belong to".

With addresses this detailed, can someone outside the room receive the message too? No, because the server decides who receives it; the client does not filter by address. XMPP is not a broadcast medium. The server writes a room's messages only into the connections of the people currently in that room. If you are not in the room, the message never appears on your connection at all. The address is metadata for routing and sorting. Access control stays with the server.

### What a room is: MUC

The core XMPP protocol only defines one to one chat. "Rooms" come from the extension spec MUC (Multi-User Chat, XEP-0045):

- A room is an object on the server with its own address. The domain in `table_08@conference.chat.acme.example` is the conference subservice, kept separate from ordinary accounts.
- Entering a room means sending a presence to the room, with a nickname. From then on you are an occupant of that room, and the room's messages start arriving on this connection. Leave the room or drop the connection and you disappear from the list.
- Speaking in a room means sending a `type='groupchat'` message to the room address. The server copies it to every occupant, including a copy back to the speaker (reflection).

## What it looks like once connected

Both ends use existing software. On the server side, start an ejabberd (or Openfire, Prosody) and configure the domain. It accepts several kinds of connection at once: standard client connections on TCP port 5222 (the default set by RFC 6120), and browsers over WebSocket, attached to the server's HTTP listener, with the port and path configured per deployment. Whichever way a client connects, the accounts and rooms are the same set.

On the browser side, take an existing library: Strophe.js works on the XML directly, which shows the raw protocol most clearly; stanza wraps everything in a JSON style API; Converse.js even includes the chat UI (underneath, it is Strophe). After that, the code is a connect plus one callback for incoming messages.

The order of connecting:

```text
browser → XMPP server

1. HTTPS handshake + Upgrade: websocket
2. Open the XML stream
3. SASL authentication
4. Bind a resource (this is how several tabs on one account are told apart)
5. Send presence, meaning "I am online"
6. Send presence to the room JID, meaning enter the room
7. From here the connection stays open and stanzas flow both ways
```

Step 1 belongs to WebSocket. XMPP starts at step 2. This matches the layering above: connect the pipe first, then talk inside the pipe by the rulebook.

The last line of the diagram is the connection staying open. From this point, no message received is the response to any request. There is no question and answer pairing on the connection (except `<iq>`). Outgoing and incoming stanzas are two independent streams, each flowing its own way. When the server has something, it writes it straight into the connection. On the client side, the socket's read event fires, then the client parses, checks `from`, and sorts into a window. The copy of your own message you receive after speaking in a room is not a response either. It is the share you get as an occupant when the server delivers to the whole room.

## What the server actually does

An XMPP server is a post office. It reads the envelope (to, from) to decide where to deliver, and does not open the letter to read the contents.

This spec puts custom elements inside standard messages:

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

`<event type='mute'>` is a name this system invented; it is not in the XMPP rulebook. A custom element should carry its own namespace so it does not collide with someone else's `<event>`. The example above leaves it out; the code below fills it in as `urn:example:chat`.

One mute involves four roles. Below is a piece of code for each.

**The moderator's browser**: an ordinary web page, nothing to do with XMPP.

```js
await fetch('/api/rooms/table_08/mute', {
  method: 'POST',
  body: JSON.stringify({ user: 'mina02', until: '2026-12-31T00:00:00Z' })
})
```

**Your own backend**: decides who gets muted and for how long. It is also connected to the XMPP server under the `ops_bot` account and sits in the room as a moderator; otherwise the iq below would be bounced back with `<not-allowed/>`. The stanzas are written as plain strings here so they are easy to read; in practice the library provides a builder.

```js
app.post('/api/rooms/:room/mute', async (req, res) => {
  const { user, until } = req.body
  requireModerator(req.session.user, req.params.room)
  await db.mutes.upsert({ room: req.params.room, user, until })   // the source of truth lives in your own DB

  // 1. make the XMPP server actually block him from speaking (XEP-0045 §8.4)
  await opsBot.send(`
    <iq to='table_08@conference.chat.acme.example' type='set' id='voice2'>
      <query xmlns='http://jabber.org/protocol/muc#admin'>
        <item nick='mina02' role='visitor'/>
      </query>
    </iq>`)

  // 2. notify him so his screen reacts
  await opsBot.send(`
    <message to='mina02@chat.acme.example' type='chat'>
      <event xmlns='urn:example:chat' type='mute' end_time='${until}'/>
      <body>You have been muted until ${until}.</body>
    </message>`)

  res.sendStatus(204)
})
```

**The XMPP server**: you do not write this part. ejabberd is written in Erlang; below is pseudo code rewritten in JS from the rules in XEP-0045, to show what checks it makes on receiving each of those two stanzas.

```js
onMucAdminIq(iq) {                                    // §8.4
  const room = rooms[iq.to]
  const item = iq.query.item                          // <item nick='…' role='visitor'/>
  if (room.roleOf(iq.from) !== 'moderator') return reply(error('not-allowed'))
  room.occupants[item.nick].role = item.role
  reply(result())
  broadcastPresence(room, item.nick, item.role)       // everyone in the room receives this presence
}

onGroupchatMessage(msg) {                             // §7.4
  const room = rooms[msg.to]
  if (room.roleOf(msg.from) === 'visitor') return reply(error('forbidden'))
  for (const o of room.occupants) deliver(o.jid, msg)  // a muted user never reaches this line
}

onChatMessage(msg) {
  route(msg.to, msg)      // only looks at to. What is inside <event> is neither parsed nor cared about
}
```

**mina02's browser**: your own web page, written with Strophe.js.

```js
conn.addHandler(onMuteEvent, 'urn:example:chat', 'message')

function onMuteEvent(stanza) {
  const ev = stanza.querySelector('event')
  if (ev.getAttribute('type') === 'mute') {
    ui.inputBox.disabled = true
    ui.banner.show(`Muted until ${ev.getAttribute('end_time')}`)
  }
  return true
}
```

If mina02 switches to Gajim, an XMPP client written by someone else, and logs into the same account, it connects just the same, because connection and login follow the standard. The difference is that its handler table has no `urn:example:chat`. Gajim is written in Python; below is again pseudo code:

```js
function onMessage(stanza) {
  const body = stanza.querySelector('body')
  if (body) ui.appendBubble(body.textContent)    // nobody handles <event>, so it just passes by
}
```

His input box does not turn gray; he only sees one English sentence. But whatever he types still cannot enter the room, because what rejects him is the line `role === 'visitor'` on the server, and that is the same whichever client he uses. The decision lives in your own DB, the enforcement in the XMPP server, and the custom event is only a notification.

"Keep the server dumb, put the logic at both ends" is the default. Only when a business rule has to take effect on the message path does a small piece of logic go into the server: use the roles it already has, or write a plugin when the rule is too specific.

## How it differs from a message queue

"The broker reads only the envelope and never opens the contents, the producer drops messages in, the broker decides who gets them." That description fits Kafka or RabbitMQ without changing a word. An XMPP server and a message queue really are the same family. Cut along the [four axes of a message system](article://message-system-axes) and the differences appear:

| Axis | Message queue | XMPP server |
|---|---|---|
| Which layer | between backend services | server to the end user's device |
| Recipient | "any one worker": ten consumers, whoever is free takes it; a message is work waiting to be assigned | "this exact person": a mute notice for mina02 cannot be picked up by anyone else; the address is an identity |
| Storage | storing is the core: if a consumer dies the message waits, and can be read again | realtime delivery is the core: push while the person is online; offline messages were a later extension |
| Connection | consumers are services in the data center with stable connections | the other end is phones and browsers that drop, switch networks, and open three tabs |

A message queue decouples services. It assumes the consumer may not be there, so the effort goes into persistence, retries, and consumer groups. XMPP connects people. It assumes the person is online and waiting right now, so the effort goes into presence, account authentication, and one person on several devices.

The same system often needs both. Between the operations console and the backend services there may be a queue (service to service). The last leg, from the backend to the player's phone, is where XMPP comes in (server to person). The same "mute" is work to be processed in the first half and a notification to a person in the second.

## Choosing: when is it XMPP's turn

Situation: a game platform needs room chat. The requirements laid out: group chat rooms, one to one chat, muting, guest login without registration, and the operations side must be able to broadcast events to a room. The frontend is a browser, with tens of thousands of people online at once.

The common decision path goes like this. The first step is almost always raw WebSocket plus JSON, because it is the fastest way to see something move: define your own message format, manage rooms with one room Map. Up to here everything goes smoothly.

Then the requirements arrive one by one: online status (build your own heartbeat and broadcast), offline messages (build your own storage and redelivery), multiple devices (two tabs on the same account, and messages must reach both), muting (build your own permission model). Every one of these is an existing chapter in the XMPP rulebook. Building them yourself means inventing the XEPs all over again, without the documentation.

With XMPP instead: start an existing server, connect an existing library on the frontend (the combination from the earlier section), and login, rooms, routing, and presence all have existing implementations. Custom needs go into standard messages as `<event>` extensions. The spec at the start of this article is only a few pages long precisely because the rulebook and the existing server handle everything else. All that needs writing is "what we added on top of the standard".

When you would regret it:

- **The XML overhead becomes visible.** On mobile networks, in bytes per message and in battery, XML is a step behind a compact binary format. When message volume grows until the bandwidth cost is significant, that is the time to reassess.
- **Customization outgrows the standard.** When most features turn out to be plugins and detours around the protocol, and the interoperability the standard brings goes unused (every client is your own), what remains of XMPP's value is only the existing connection management. Raw WebSocket with a good framework may be more direct.
- **Nobody on the team wants to learn the XEPs.** The learning curve of the protocol is the whole rulebook. Choosing again today, the open protocol road also has Matrix (an open standard since 2014, RESTful HTTP plus JSON, end-to-end encryption built in, room state synchronized between servers). If you only push events and do not need full chat semantics, a lightweight pub/sub protocol like MQTT costs less. Or buy a hosted chat service: connect the SDK and it is there, in exchange for usage based billing and your data in someone else's hands.

The other way round, when XMPP is still the right choice: the requirements overlap heavily with the standard model of "people messaging people in real time" (rooms, presence, multiple devices, muting), and you want to own the data and the server yourself. The more overlap, the more the rulebook and the existing server give you for free, and what you write yourself shrinks to those few pages of spec.
