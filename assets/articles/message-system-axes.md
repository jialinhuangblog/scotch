---
title: "有 producer 和 consumer，就是 pub/sub 嗎"
slug: message-system-axes
date: 2026-07-07
subtitle: "訊息系統的筆記怎麼整理，每個工具都同時落進好幾格，因為 pub/sub、topic、queue 這批名詞混了四個不同的問題。"
chapter: "messaging"
tags: [message-queue, kafka, pub-sub, sqs, sns, rabbitmq, exchange, system-design]
related: [the-log, queue-peak-shaving, url-shortener-demo, http-realtime-pushing, why-kafka, kafka-partitions-groups, sns-sqs, rabbitmq-routing, why-xmpp]
---

# 有 producer 和 consumer，就是 pub/sub 嗎

每個訊息系統的架構圖長得都一樣。左邊一個 producer，右邊一個 consumer，中間一坨。IBM MQ 這樣畫，RabbitMQ 這樣畫，Kafka、Pulsar 也這樣畫，差別只是中間那坨越來越大。

所以很容易以為：有發訊息的、有收訊息的，一個 publish 一個 subscribe，這就是 pub/sub。

然後筆記就開始亂了。Kafka 一下被叫 event streaming，一下被叫 pub/sub，一下被叫 distributed log。SQS 明明也是有人發有人收，文件卻說它不是 pub/sub。RabbitMQ 有個東西叫 topic，Kafka 也有個東西叫 topic，兩個長得完全不一樣。每次想把這些整理成一張分類表，每個工具都同時落進好幾格，怎麼排都覺得不完美，沒辦法用一張表把訊息系統講清楚。

這不是理解的問題，是這批名詞本身混了四個互相獨立的問題：一則訊息給一個人還是給所有人（送法）、訊息被讀走之後刪掉還是留著（存法）、broker push 給 consumer 還是 consumer 自己 pull（推拉）、這東西在服務之間還是在 server 到瀏覽器之間（哪一層）。每個工具都要把這四題各答一次，只有單一類別的分類表寫不下四個答案。

這幾個問題我自己全都搞混過。

---

## producer/consumer 是角色，pub/sub 是送法

producer 是寫進去的那端，consumer 是讀出來的那端，這兩個字講的是角色。有些系統把它們叫 publisher 和 subscriber，有些叫 sender 和 receiver，講的都是這兩個角色。**每個**訊息系統都有這兩個角色，IBM MQ 有，SQS 有，Kafka 有。所以「它有 producer 和 consumer」這句話不帶任何分類資訊，等於在說「它是一個訊息系統」。

pub/sub 不是角色，是送法：一則訊息，幾個 consumer 拿到。

一個拿到，叫 point-to-point。多個 consumer 的時候它們是搶的，誰搶到就是誰的，別人看不到這則。全部訂閱的人都拿到一份，才叫 pub/sub，那是廣播。

兩組詞在不同層。角色永遠成對存在，沒有例外；要分類一個系統，只有送法答得出東西。這兩組詞會被混為一談，是因為 pub/sub 系統裡的 producer 慣稱 publisher、consumer 慣稱 subscriber，名字撞在一起，讓人以為看到 pub 和 sub 兩個角色就等於 pub/sub 這個送法。但角色成不成對，跟送法是不是廣播，本來就沒有關係。判斷送法只有一個問題：一則訊息，一個人拿到，還是每個人都拿到。

---

## consumer 在搶，那不同服務怎麼收到同一個事件

「一則訊息只給一個 consumer，搶到就是誰的。」聽到這句的第一個反應通常是：那我有帳單、寄信、分析三個服務都要知道這筆訂單，怎麼辦？用搶的，另外兩個服務不就收不到了？

卡住的地方在「consumer」這個詞，同一個字指的可能是兩種不同的單位：

| 架構 | 算幾個 consumer | 一則訊息 |
|---|---|---|
| 帳單服務開 5 個副本分攤流量 | 5 個副本算同一個 consumer | 只有一個副本拿到 |
| 帳單、寄信、分析三個服務 | 3 個服務算 3 個 consumer | 每個服務各拿一份 |

會用搶的只有第一種。帳單服務為了消化流量開了 5 個副本，跑同一份 code、做同一件事。一則扣款訊息進來，只該被處理一次。所以 5 個副本用搶的，誰搶到誰做。要是 5 個都收到，客戶就被扣 5 次款。搶是同一個服務內部的分工方式，它從頭到尾就沒打算把訊息分給「別的服務」。

不同服務各要一份，是另一個問題，答案是把訊息複製成三份，一個服務一份。這個複製動作叫 fan-out，也就是 pub/sub 真正出場的地方。AWS 把這兩件事拆成兩個產品，接在一起用：

```
訂單事件
  → SNS（pub/sub：複製成三份）
       → SQS 佇列 A → 帳單服務的 5 個副本搶
       → SQS 佇列 B → 寄信服務的副本搶
       → SQS 佇列 C → 分析服務的副本搶
```

SNS 解決「三個服務各要一份」，SQS 解決「一個服務的副本怎麼分工」，兩個產品各答一題。

Kafka 把這兩題收進同一個機制，叫 consumer group：同一個 group 裡的副本互相搶，不同的 group 各自拿到完整的一份，對內是搶、對外是廣播。上面那張 SNS 加 SQS 的圖，等於把 consumer group 拆成兩個產品來做。

---

## RabbitMQ 的 direct、topic、fanout 是三種模式嗎

是三種規則，不過得先知道這些規則設定在哪個位置。

RabbitMQ 的 producer 從來不直接把訊息放進 queue。它把訊息交給一個叫 exchange 的東西，exchange 再根據綁定（binding）決定這則訊息要複製幾份、丟進哪幾個 queue。direct、topic、fanout 就是 exchange 決定「丟哪」的三種規則：

- **direct**：routing key 完全相符才送。key 是 `billing`，只進綁了 `billing` 的 queue。
- **topic**：key 用 pattern 比對，`logs.*.error` 接得住 `logs.api.error`、`logs.db.error`。
- **fanout**：不看 key，複製給每一個綁定的 queue，就是廣播。

這跟上一段的 SNS 加 SQS 其實一樣。exchange 那層決定複製幾份（fanout 綁三個 queue，效果就是 SNS）；每個 queue 內部永遠是搶（一個 queue 掛多個 consumer，效果就是 SQS）。SNS 加 SQS 是把兩層拆成兩個產品，RabbitMQ 是把兩層裝進同一個 broker。所以 RabbitMQ 才會「又是 queue 又能 pub/sub」：一則訊息複製給幾個 queue，是 exchange 底下綁了幾個 queue 決定的。fanout 綁三個 queue，三個服務各拿一份，那就是 pub/sub；direct 只綁一個 queue，那就是 point-to-point。同一個 RabbitMQ，換個綁法就換一種送法。

**RabbitMQ 的 topic 和 Kafka 的 topic 不是同一個東西。** Kafka 的 topic 是名詞，是訊息實際存放的地方：produce 一次就 append 到這個 topic，consumer 讀的也是這個 topic。RabbitMQ 的 topic 是 exchange 的一種配對規則：訊息只是路過它，被篩進某些 queue，真正存放的位置是 queue。一個是儲存單位，一個是路由行為。**別再糾結兩邊都叫 topic。**

另一批名字反而是真的同義。Kafka 的 topic、MQTT（Message Queuing Telemetry Transport）的 topic、Redis 的 channel、NATS 的 subject、SignalR 的 Group，這五個都是名詞，是被訂閱的那個名字，一次廣播會送到的範圍就是它。RabbitMQ 不在這排裡：它訊息真正存放的地方是 queue，前面多一層 exchange 做分發。

---

## Kafka 的 log 是誰在寫？consumer 自己 pull 還是被 push？

Kafka 是一份 log，那這份 log 是誰寫的？要自己去 append 嗎？

寫的人就是 producer。呼叫一次 produce，那則訊息就被 append 到 topic 的尾巴，這個動作本身就是「寫 log」，沒有另外一個寫 log 的步驟。在 [URL shortener demo](article://url-shortener-demo) 裡，就是轉址 handler 呼叫 `kafka.Publish` 把 click event 丟進 `click-events` 這個 topic，一次呼叫、一筆 append。

consumer 不碰 log 本體。它唯一寫的東西是自己的 offset，也就是「我讀到第幾筆」這個書籤，記在 Kafka 內部。log 是共用的、唯讀的；進度是各自的、私有的。兩個 consumer group 讀同一份 log，各自記各自的書籤，誰也不干擾誰。這是 [The Log](article://the-log) 那篇的主題。

那 consumer 是自己 pull，還是等 broker push 給它？**Kafka 只有 pull，沒有 push。** consumer 自己發 fetch 請求要資料。這樣不會變成不停輪詢嗎？它用的是 long poll：fetch 請求可以掛著等，等到有資料才回，還能指定至少累積多少資料再一起回，避免空轉輪詢。所以體感接近即時，但主導權在 consumer：它消化多快就 pull 多快，處理不過來就放慢，broker 沒有辦法把訊息硬塞給它。這就是 pull 的好處，消費速度天生由消費者控制。

RabbitMQ 預設是反過來的：broker 主動 push 給 consumer，用 prefetch 上限防止一次送太多。push 的即時性好，pull 的流量控制好，這是第三題「推拉」的兩端。

---

## SQS 是 pull，所以不算 pub/sub？

我筆記裡真的這樣寫過：「SQS is PULL，所以不太算 pub/sub」。SQS 確實不算 pub/sub，但這個理由是錯的。

Kafka 也是 pull，上一段才講完。但 Kafka 開兩個 consumer group 就是 pub/sub。可見「用 pull」跟「算不算 pub/sub」根本是兩個獨立的問題，pull 跟送法沒有因果關係。

SQS 不算 pub/sub 的真正原因是送法：它是 point-to-point，一則訊息被一個 consumer 收走、刪掉，就沒了，做不到每個訂閱者各拿一份。就這麼直接，跟它用 pull 沒有關係。

| | 送法 | 推拉 |
|---|---|---|
| SNS | pub/sub | push |
| SQS | point-to-point | pull |
| Kafka | consumer group 決定，兩種都能 | pull |

Kafka 那一列就是反例：pull 也能 pub/sub，所以「因為 pull，所以不是 pub/sub」不成立。

會有這個錯覺，是因為 SQS 剛好同時是 point-to-point 和 pull，SNS 剛好同時是 pub/sub 和 push。兩個屬性每次一起出現，看起來像因果，但它們只是碰巧同時發生。把送法和推拉當成兩個獨立的問題分開回答，中間沒有因果就看出來了。

---

## 送完之後，需要等 consumer 回 ack 嗎

pub/sub 是 broker 把訊息複製給每個在線的訂閱者，送完就不保留。聽起來像是天生不用等 ack。Redis pub/sub 確實如此：寫進每條訂閱連線就結束，沒了就沒了。

但 SNS 推訊息到 HTTP endpoint，要等對方回 200 才算送達，失敗會重試；MQTT 的 QoS（Quality of Service）1，broker 送給每個訂閱者都要等 PUBACK。都是 pub/sub，都有 ack。

所以「要不要 ack」不跟著送法走，它是另一個獨立的問題：[送達保證](chunk://delivery-guarantees)。MQTT 直接把它攤成三個等級，每則訊息自己選：QoS 0 送出不管（at most once）、QoS 1 重送到收到 PUBACK 為止（at least once，可能重複）、QoS 2 四步握手（exactly once，最貴）。同一個協定、同樣 pub/sub，ack 可有可無，這是可調的設定，不是 pub/sub 或 queue 的身分。

真正跟送法綁定的是 ack 的「意思」。queue 的 ack 是「這則可以刪了」：一個 consumer ack，訊息從此消失。pub/sub 的 ack 是「這個訂閱者收到了」：每個訂閱者各自記錄，A 的 ack 不影響 broker 對 B 的重送。SNS 有 ack 也不會變成 queue，它的 ack 不刪訊息，只是停掉對這一個訂閱者的重試。

那 ack 本身丟了怎麼辦？要不要 ack 的 ack？沒有盡頭。分散式系統的做法不是追求確知送達，是把重送變得無害：at-least-once 配上消費端冪等，重複十次效果等於一次（見 [idempotency](chunk://idempotency)、[exactly-once](chunk://exactly-once)）。

---

## Kafka 會自己去讀 Redis 嗎

在 demo 裡，一次點擊同時讓 Redis 的 counter++，也讓 Kafka 多一筆 click event。我一度以為是 Kafka 在監聽 Redis：計數一動，Kafka 自動撈走。

Kafka 不會。它不監聽任何東西，訊息進 Kafka 的唯一方式是有人主動呼叫 produce 寫進去；它不會伸手去看 Redis，也不輪詢誰。實際發生的事是：

```
click → shortener handler
          ├─ Redis INCR clicks:<key>     （寫 A：即時計數）
          └─ kafka.Publish(click event)  （寫 B：丟了就走，不等它）
                → consumer pull 出來 → ClickHouse（分析）
```

Redis 和 Kafka 互相不知道對方存在。是 handler 這段程式，拿著同一次點擊，各寫了一邊。而且它也只能這樣做：Kafka 那筆事件帶著 IP、user agent、timestamp，要給 ClickHouse 做分析用；Redis 裡只有一個數字，就算真有東西去監聽 Redis，也湊不出這些欄位。

demo 的程式攤開來就是這樣（Go，segmentio/kafka-go）：

```go
// 寫入端：轉址 handler，同一次點擊各寫一邊（redirect.go）
h.redis.IncrClick(ctx, shortKey)        // 寫 A：Redis 計數 +1
h.kafka.Publish(store.ClickEvent{       // 寫 B：丟進 Kafka，不等它
    ShortKey: shortKey, Timestamp: time.Now(),
    IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
})

// Publish 是 fire-and-forget，redirect 不等（store/kafka.go）
func (k *KafkaProducer) Publish(e ClickEvent) {
    b, _ := json.Marshal(e)
    go k.writer.WriteMessages(ctx, kafka.Message{Value: b})  // append 到 topic 尾巴
}

// 讀取端：另一個 process，自己 pull（cmd/consumer/main.go）
r := kafka.NewReader(kafka.ReaderConfig{
    Topic:   "click-events",
    GroupID: "analytics-consumer",   // 自己的 group，記自己的 offset
})
for {
    msg, _ := r.ReadMessage(ctx)     // long poll：掛著等，有資料才回
    // parse → 批次寫進 ClickHouse
}
```

寫入是 handler 主動 `Publish`，讀取是 consumer 主動 `ReadMessage`，兩邊都得有人動手。沒有一行是 Kafka 自己去看 Redis。

「一個系統自動監聽另一個系統的變化」這功能本身是存在的，叫 CDC（Change Data Capture）：外掛一個元件去讀資料庫的內部 log，把每筆變更轉成訊息寫進 Kafka。但主詞還是那個外掛元件在主動讀，Kafka 依然只是被寫入的那方。

---

## 四題答完，攤開來看

到這裡四個問題都出場了：送法（給一個還是給全部）、存法（刪還是留）、推拉（broker push 還是 consumer pull）、哪一層。把主要的後端 broker 攤在四題上：

| 工具 | 送法 | 存法 | 推/拉 | 哪一層 |
|---|---|---|---|---|
| RabbitMQ | exchange 接法決定，兩種都能 | 刪（ack 後清掉） | push（prefetch 節流） | 後端服務之間 |
| Kafka | consumer group 決定，兩種都能 | log（留著，offset 記進度） | pull（long poll） | 後端服務之間 |
| Kinesis | 同 Kafka | log | pull | 後端服務之間 |
| SQS | point-to-point | 刪 | pull | 後端服務之間 |
| SNS | pub/sub | 不存（送完即走） | push | 後端服務之間 |
| NATS | pub/sub（queue group 可搶） | 不存（JetStream 才留） | push | 後端服務之間 |
| WebSocket / SSE | 沒有送法，要廣播自己實作 | 不存 | SSE 單向 push、WS 雙向 | server 到瀏覽器最後一哩 |

這張表就是整篇文章。每個工具是四個答案的組合，不是一個類別的成員。Kafka 之所以同時被叫 streaming、pub/sub、distributed log，是因為三個名字各指它某一題的答案：留著（存法）、group 對外廣播（送法）、log 這個結構本身。三個名字沒有衝突，它們回答的是不同的題目。

表格最後一列的 WebSocket、SSE（還有 SignalR）跟上面那些不是同一種東西。它們只是最後靠近 client 的那段實作，跟這裡講的 message queue 無關：不存訊息、沒有送法可言，要廣播得自己在上面實作（SignalR 的 Group 就是這樣來的）。demo 裡的 SSE 把每次點擊 push 到 dashboard，跟後端那條 Kafka 管線各管各的，一個對瀏覽器、一個對服務。早期我把它們跟 broker 混在同一張分類表裡，那也是那張表怎麼排都排不出來的原因之一。

送達保證（at most / at least / exactly once）在四題之外。它不拿來定位系統，因為幾乎每家都做成可調的：MQTT 的 QoS 三檔、RabbitMQ 的 ack 模式、Kafka 的 offset commit。定位用四題，選型時把這個設定另外問一次。

下次碰到新的訊息系統，與其問它屬於哪一類，不如把四個問題各問一次：一則訊息給一個還是給全部？讀走之後刪還是留？broker 主動 push 還是 consumer 自己 pull？服務之間還是最後一哩？四個答案合起來，就是這個系統的位置。各家產品更細的選型取捨，[Queue 選型](chunk://message-queue-comparison)那張 chunk 有整理；訊息會在哪裡漏、漏了怎麼補，在[削峰那篇](article://queue-peak-shaving)。
