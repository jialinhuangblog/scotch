---
title: "Variable-Length Encoding"
slug: varint-encoding
brief: "押注常見值比較短，長的再用 escape code 或 continuation bit 處理。protobuf、UTF-8、WebSocket frame、HPACK 共用的省 bytes 手法。"
date: 2026-05-27
updated: 2026-07-20
revisions: 2
---

# Variable-Length Encoding

這篇講一個共通手法：怎麼用**最少的 bytes** 存一個「大多時候很小、偶爾很大」的值。協定跟檔案格式裡到處是這種值（訊息長度、欄位數量、一個字元佔幾 bytes），範圍可能從 2 一路到上 GB。為了裝得下最大值就用固定大寬度，結果小值全在浪費；變長編碼就是來解這件事的。protobuf、UTF-8、WebSocket frame、HPACK 都靠它省 bytes。

<details>
<summary><strong>為什麼要先「寫長度」？HTTP vs gRPC 怎麼斷句（點開看）</strong></summary>

資料送過一條 stream，接收端拿到的是連續 bytes，得知道每段在哪結束。文字格式可以挑一個正常內容不會出現的字當分隔符（HTTP 用換行 `\r\n`）。binary 不行：任何 byte 都可能是真資料，挑什麼當 marker 都可能撞到。所以 binary 改用「先寫長度」，數 byte 數、不找分隔符。gRPC 是 binary，每一層都先報長度，最內層的 protobuf 欄位就用 varint 把長度數字壓到最小。

```text
一般 HTTP/1.1 請求（文字，用換行斷句）
──────────────────────────────────
POST /api/user HTTP/1.1   ⏎     每行用 \r\n 斷
Host: example.com         ⏎
Content-Length: 23        ⏎     ← body 有多長
                          ⏎     ← 空行 = header 結束
{"name":"jia","age":30}         ← 讀 Content-Length 個 byte = body
人看得懂；斷句靠「換行」這個分隔符


gRPC 請求（protobuf over HTTP/2，二進位，每層先寫長度）
──────────────────────────────────
HTTP/2 DATA frame
  [長度 3B][type 1B][flags 1B][stream-id 4B]            ← frame 先報自己多長
    gRPC message
      [壓縮旗標 1B][訊息長度 4B big-endian][protobuf bytes]  ← 再報訊息多長
        protobuf
          [tag〈varint〉][長度〈varint〉][value] …          ← varint 在這層
機器讀的；斷句靠「先寫長度」，數 byte 數，不找分隔符
```

</details>

## 固定寬度的兩難

假設你設計一個 protocol，header 裡有「payload 長度」欄位。

用 uint64（8 bytes）寫長度：

```text
傳 "hi" (2 bytes payload):
  [8 bytes 長度欄位 = 2] [2 bytes payload]
  → header 是 payload 的 4 倍 ❌
```

用 uint16（2 bytes）寫長度：

```text
最大支援 65,535 bytes。要傳 1 GB 檔案？塞不下 ❌
```

短訊息浪費、長訊息塞不下，固定寬度逃不掉這個 trade-off。

## 變長編碼：賭 common case

核心想法：**欄位寬度跟著值的大小走**。短的編到最小、長的允許但付一點 overhead。

賭的是 **value 大小的分佈高度偏短**：聊天訊息多數是 "hi" / emoji / 通知，幾百 bytes 以下；protobuf 一條 message 裡的欄位大部分是小整數。為了 1% 的長 case 把所有 case 都拉到一樣大，不划算。

## 三種主流實作

### A. Escape code（保留特殊值）

用例：**WebSocket frame**、SQLite varint、ASN.1 BER length。

留幾個值當「請翻頁」marker：

```text
WebSocket frame 的 7-bit length 欄位：
  讀到 0-125  → 這個數就是真實長度
  讀到 126    → 後面 2 bytes 才是真實長度
  讀到 127    → 後面 8 bytes 才是真實長度
```

126 跟 127 不再代表長度，是 escape code。完整故事看 [websocket](chunk://websocket)。

### B. Continuation bit

用例：**Protobuf varint**（Variable-Length Integer）、MIDI delta-time、WebAssembly LEB128（Little Endian Base 128）。

每 byte 的最高 bit 當 flag，剩 7 bit 存值：

```text
最高 bit = 1 → 「還沒完，下一個 byte 也是這個數的一部分」
最高 bit = 0 → 「結束」

例：300 → 二進位 100101100
  拆成兩段 7-bit：0000010 / 0101100
  輸出：10101100 00000010
        ↑ MSB=1 繼續    ↑ MSB=0 結束
```

小數字（0-127）只占 1 byte，大數字依規模延伸。protobuf 一條 message 裡欄位 tag 跟 length 全用這套，能省的都省下來。

### C. Leading-byte pattern

用例：**UTF-8**。

第一個 byte 的開頭 bit pattern 直接表明整個字元用幾 bytes：

```text
0xxxxxxx                              → 1 byte（ASCII，0-127）
110xxxxx 10xxxxxx                     → 2 bytes
1110xxxx 10xxxxxx 10xxxxxx            → 3 bytes（中日韓常見字）
11110xxx 10xxxxxx 10xxxxxx 10xxxxxx   → 4 bytes（emoji、罕用字）
```

continuation bytes 開頭都是 `10`，自帶**自同步**：從 stream 中間插入也能找到字元邊界。

## Trade-off

| 維度 | 固定寬度 | 變長編碼 |
|---|---|---|
| 編碼 / 解碼成本 | O(1)，直接讀 | 要 branch，逐 byte 判斷 |
| Random access | 可以算 offset 跳 | 必須順序解 |
| 短 case overhead | 浪費 | **最省** |
| 長 case overhead | 不變 | 多 1-8 bytes |
| 實作複雜度 | 低 | 中 |

## 何時用、何時不用

**用**：
- 值分佈高度偏短（chat、protobuf 欄位、UTF-8 文字）
- Stream protocol，逐 byte 處理本來就 sequential
- Bandwidth 敏感場景

**不用**：
- 需要 random access（資料庫 record offset 用固定寬度才能算）
- 值分佈均勻（變長省不了多少）
- 極端 hot path（branch prediction miss 比省的 bytes 還貴）

## 共同 design 直覺

不只是「省 bytes」這層，更深的是 **protocol designer 對使用情境做統計判斷**：

- WS 設計者知道 chat 主流是短訊息 → 7 bit + escape code
- Protobuf 設計者知道一條 message 裡欄位多數是 small int → continuation bit
- UTF-8 設計者知道 ASCII 仍是主流字元 → 留 0xxxxxxx 完全相容

所以選哪種，看資料分佈：偏短就用變長賭一把，分佈均勻就用固定寬度。這個直覺在寫任何 protocol 都通用。
