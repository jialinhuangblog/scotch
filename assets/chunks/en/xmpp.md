---
title: "XMPP"
slug: xmpp
brief: "An application-layer protocol for chat: it defines identity, presence, rooms and delivery semantics. TCP, WebSocket and BOSH can all carry it."
date: 2026-07-24
updated: 2026-08-08
revisions: 1
article: why-xmpp
---

# XMPP

> Build a chat room on WebSocket yourself and you have to invent login, rooms and presence from scratch, and only your own client understands them. Is there an existing rulebook?

## A protocol, not an implementation

XMPP (Extensible Messaging and Presence Protocol) sits at the same layer as HTTP: a public rulebook that defines what a message looks like, in what order the conversation goes after connecting, and what the server must do when it receives something. A client and a server written to the rulebook can talk to each other, so a chat server is installed (ejabberd, Openfire), not written, the same way a website installs nginx instead of writing its own web server.

## Three kinds of stanza

Each independent XML unit sent over the connection is called a stanza. There are three kinds:

| stanza | What it does | Example |
|---|---|---|
| `<message>` | Sent and done, the server does not reply | `<message to='mina02@chat.example' type='chat'><body>are you there</body></message>`<br>`type='groupchat'` sends it to a room |
| `<presence>` | Reports your own status, the server broadcasts it to everyone subscribed to this account | `<presence><show>away</show><status>eating</status></presence>`<br>Joining a room is also a presence sent to the room's JID |
| `<iq>` | One question, one answer; the `id` has to match to know which reply belongs to which request | Ask: `<iq type='get' id='r1'><query xmlns='jabber:iq:roster'/></iq>`<br>Answer: `<iq type='result' id='r1'>` carries back the contact list |

An address is called a JID (Jabber ID) and looks like an email: `mina02@chat.example`. A room is also a JID, under the conference subservice. Group chat is defined by the extension spec MUC (Multi-User Chat, XEP-0045): a room is an object on the server, you join by sending presence, you speak by sending groupchat, and the server copies it to everyone in the room.

## What XMPP runs on

The XMPP rulebook only covers the application layer: what a stanza looks like, what the server does when it receives one. What carries this XML to the other side underneath is not in the rulebook; anything that can send bytes both ways will do.

```text
XMPP
 ├─ raw TCP      native apps, backend services
 ├─ WebSocket    browsers
 └─ BOSH         all HTTP, uses long polling to simulate two-way (a leftover from before WebSocket)
```

So "is XMPP based on WebSocket" has it backwards: XMPP is ten years older than WebSocket, and WebSocket is just one more transport it gained later.
