---
title: "Variable-Length Encoding"
slug: varint-encoding
brief: "Bet that common values are short, and handle the long ones with an escape code or a continuation bit. The byte-saving technique shared by protobuf, UTF-8, WebSocket frames and HPACK."
date: 2026-05-27
updated: 2026-10-17
revisions: 3
---

# Variable-Length Encoding

Protocols and file formats are full of values that are "small most of the time, large once in a while". How do you store them in the **fewest bytes**? Such values (message length, number of fields, how many bytes one character takes) can range from 2 all the way up to gigabytes. Use a fixed large width to fit the maximum, and every small value becomes wasted space. Variable-length encoding exists to solve this. protobuf, UTF-8, WebSocket frames and HPACK all rely on it to save bytes.

<details>
<summary><strong>Why "write the length first"? How HTTP and gRPC find message boundaries (click to open)</strong></summary>

Data goes over a stream, and the receiver gets a continuous run of bytes; it has to know where each piece ends. A text format can pick a character that never appears in normal content as a delimiter (HTTP uses the newline `\r\n`). Binary cannot: any byte may be real data, so whatever marker you pick can collide with it. So binary switches to "write the length first": count bytes instead of searching for a delimiter. gRPC is binary, and every layer states its length first; at the innermost layer, protobuf fields use varint to squeeze the length number down to the minimum.

```text
A plain HTTP/1.1 request (text, split by newlines)
──────────────────────────────────
POST /api/user HTTP/1.1   ⏎     each line ends with \r\n
Host: example.com         ⏎
Content-Length: 23        ⏎     ← how long the body is
                          ⏎     ← blank line = end of headers
{"name":"jia","age":30}         ← read Content-Length bytes = body
Readable by humans; boundaries come from the "newline" delimiter


A gRPC request (protobuf over HTTP/2, binary, each layer writes its length first)
──────────────────────────────────
HTTP/2 DATA frame
  [length 3B][type 1B][flags 1B][stream-id 4B]            ← the frame states its own length first
    gRPC message
      [compressed flag 1B][message length 4B big-endian][protobuf bytes]  ← then the message length
        protobuf
          [tag〈varint〉][length〈varint〉][value] …          ← varint lives at this layer
Read by machines; boundaries come from "write the length first": count bytes, no delimiter search
```

</details>

## The fixed-width dilemma

Suppose you are designing a protocol with a "payload length" field in the header.

Write the length as uint64 (8 bytes):

```text
Sending "hi" (2 bytes payload):
  [8 bytes length field = 2] [2 bytes payload]
  → the header is 4 times the payload
```

Write the length as uint16 (2 bytes):

```text
Supports at most 65,535 bytes. Want to send a 1 GB file? It does not fit
```

## Variable-length encoding: bet on the common case

**The field width follows the size of the value**: short values get the smallest encoding, long values are still allowed, just with a little more overhead.

The bet is that **the distribution of value sizes leans heavily toward short**: most chat messages are "hi" / an emoji / a notification, under a few hundred bytes; most fields in a protobuf message are small integers. Stretching every case to the same size for the 1% of long cases is a bad deal.

## Three mainstream implementations

### A. Escape code (reserve special values)

Used by: **WebSocket frames**, the varint proposed for SQLite4, ASN.1 BER length.

Reserve a few values to mean "the real length is written in the bytes that follow":

```text
The 7-bit length field of a WebSocket frame:
  reads 0-125  → this number is the real length
  reads 126    → the next 2 bytes are the real length
  reads 127    → the next 8 bytes are the real length
```

126 and 127 no longer stand for a length; they are escape codes. The full story is in [websocket](chunk://websocket).

### B. Continuation bit

Used by: **Protobuf varint** (Variable-Length Integer), the record varint in SQLite 3, MIDI delta-time, WebAssembly LEB128 (Little Endian Base 128).

The highest bit of each byte is a flag, and the remaining 7 bits hold the value:

```text
highest bit = 1 → "not done yet, the next byte is part of this number too"
highest bit = 0 → "end"

Example: 300 → binary 100101100
  split into two 7-bit groups: 0000010 / 0101100
  output: 10101100 00000010
          ↑ MSB=1 continue    ↑ MSB=0 end
```

Small numbers (0-127) take only 1 byte, and large numbers extend with their size. Every field tag and length in a protobuf message uses this scheme.

### C. Leading-byte pattern

Used by: **UTF-8**.

The bit pattern at the start of the first byte states directly how many bytes the whole character takes:

```text
0xxxxxxx                              → 1 byte (ASCII, 0-127)
110xxxxx 10xxxxxx                     → 2 bytes
1110xxxx 10xxxxxx 10xxxxxx            → 3 bytes (common Chinese, Japanese and Korean characters)
11110xxx 10xxxxxx 10xxxxxx 10xxxxxx   → 4 bytes (emoji, rare characters)
```

Continuation bytes all start with `10`, which makes the encoding **self-synchronizing**: start reading from the middle of a stream and you can still find the character boundaries.

## Trade-off

| Dimension | Fixed width | Variable length |
|---|---|---|
| Encode / decode cost | O(1), read directly | needs branches, decided byte by byte |
| Random access | compute the offset and jump | must decode in order |
| Short case overhead | wasted | **the least** |
| Long case overhead | unchanged | 1-8 extra bytes |
| Implementation complexity | low | medium |

## When to use it, when not to

**Use it**:
- The value distribution leans heavily toward short (chat, protobuf fields, UTF-8 text)
- Stream protocols, where processing byte by byte is sequential anyway
- Cases where bandwidth matters

**Do not use it**:
- Random access is needed (a database record offset can only be computed with fixed width)
- The value distribution is uniform (variable length saves little)
- Extreme hot paths (a branch prediction miss costs more than the bytes saved)

## The shared design intuition

All three implementations are **a protocol designer's judgment about the data distribution**:

- The WS designers knew chat is mostly short messages → 7 bits + escape code
- The Protobuf designers knew most fields in a message are small ints → continuation bit
- The UTF-8 designers knew ASCII was still the dominant character set → reserve 0xxxxxxx for full compatibility
