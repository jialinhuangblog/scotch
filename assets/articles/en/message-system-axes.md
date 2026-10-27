---
title: "Pub/sub, topic, queue: which problem each term refers to"
slug: message-system-axes
date: 2026-07-07
updated: 2026-10-17
revisions: 1
subtitle: "No matter how I sort my notes on message systems, every tool lands in several categories at once, because pub/sub, topic and queue are names that mix up four different questions."
chapter: "messaging"
tags: [message-queue, kafka, pub-sub, sqs, sns, rabbitmq, exchange, system-design]
related: [the-log, queue-peak-shaving, url-shortener-demo, http-realtime-pushing, why-kafka, kafka-partitions-groups, sns-sqs, rabbitmq-routing, why-xmpp]
---

# Pub/sub, topic, queue: which problem each term refers to

Every message system's architecture diagram looks the same. A producer on the left, a consumer on the right, a broker in the middle. IBM MQ draws it that way, RabbitMQ draws it that way, Kafka and Pulsar too. The only difference is that the box in the middle keeps getting bigger.

Kafka is called event streaming one moment, pub/sub the next, then a distributed log. SQS also has someone sending and someone receiving, yet its docs say it is not pub/sub. RabbitMQ has an exchange type called topic, Kafka has a unit called topic, and the two look nothing alike. Every time I try to sort these into one classification table, every tool belongs to several categories at once, and no arrangement works.

The reason is that these names mix up four independent questions: does one message go to one receiver or to everyone (delivery), is a message deleted after it is read or kept (storage), does the broker push to the consumer or does the consumer pull (push or pull), and does the system sit between services or between server and browser (layer). Every tool answers all four, and a table with a single category column has no room for four answers.

I have confused all four of these before.

---

## producer/consumer are roles, pub/sub is a delivery mode

The producer is the end that writes in, the consumer is the end that reads out. These two words describe roles. Some systems call them publisher and subscriber, some call them sender and receiver, but they all mean these two roles. **Every** message system has these two roles. So the sentence "it has a producer and a consumer" carries no classification information. It is the same as saying "it is a message system".

pub/sub is not a role. It is a delivery mode: one message, how many consumers get it.

One gets it: that is point-to-point. With several consumers they compete for it, whoever grabs it owns it, and the others never see that message. Only when every subscriber gets a copy is it pub/sub. That is a broadcast.

The two sets of words live on different levels. The roles always come as a pair, with no exception; to classify a system, only the delivery mode can do it. The two get mixed up because in a pub/sub system the producer is usually called the publisher and the consumer the subscriber. The names collide, so seeing the two roles pub and sub looks the same as seeing the delivery mode pub/sub.

---

## Consumers compete, so how do different services receive the same event

"One message goes to one consumer, whoever grabs it owns it." The usual first reaction: I have three services, billing, mail and analytics, and all three need to know about this order. What then? If they compete, do the other two never get it?

The sticking point is the word "consumer". The same word can mean two different units:

| Setup | How many consumers | One message |
|---|---|---|
| the billing service runs 5 replicas to share the load | the 5 replicas count as one consumer | only one replica gets it |
| three services: billing, mail, analytics | the 3 services count as 3 consumers | each service gets its own copy |

Only the first kind competes. The billing service runs 5 replicas to handle the load; they run the same code and do the same job. A charge message comes in and should be processed exactly once. So the 5 replicas compete, and whoever grabs it does the work. If all 5 received it, the customer would be charged 5 times. Competing is how work is split inside one service. It was never meant to hand messages to "other services".

Different services each wanting a copy is a separate problem. The answer is to copy the message three times, one per service. That copying is called fan-out, which is pub/sub. AWS splits these two jobs into two products and chains them:

```
order event
  → SNS (pub/sub: copy into three)
       → SQS queue A → the billing service's 5 replicas compete
       → SQS queue B → the mail service's replicas compete
       → SQS queue C → the analytics service's replicas compete
```

SNS solves "three services each want a copy". SQS solves "how the replicas of one service split the work".

Kafka folds both questions into one mechanism, the consumer group: replicas in the same group compete with each other, and different groups each get a complete copy. The SNS plus SQS diagram above is a consumer group split into two products.

---

## Are RabbitMQ's direct, topic and fanout three modes

They are three rules, but first you need to know where those rules are set.

A RabbitMQ producer never puts a message into a queue directly. It hands the message to a component called the exchange, and the exchange uses its bindings to decide how many copies to make and which queues to drop them into. direct, topic and fanout are the three rules an exchange uses to decide "where":

- **direct**: deliver only on an exact routing key match. A key of `billing` goes only into queues bound to `billing`.
- **topic**: match the key against a pattern. `logs.*.error` matches `logs.api.error` and `logs.db.error`.
- **fanout**: ignore the key and copy to every bound queue. That is a broadcast.

This is the same as SNS plus SQS in the previous section. The exchange layer decides how many copies (a fanout bound to three queues has the effect of SNS); inside each queue it is always a competition (several consumers on one queue has the effect of SQS). SNS plus SQS splits the two layers into two products; RabbitMQ puts both layers inside one broker. That is why RabbitMQ is "a queue and also pub/sub": how many queues a message is copied to is decided by how many queues are bound under the exchange. A fanout bound to three queues gives three services a copy each, and that is pub/sub. A direct bound to one queue is point-to-point.

**RabbitMQ's topic and Kafka's topic are not the same concept.** Kafka's topic is a noun, the place where messages are actually stored: one produce call appends to this topic, and the consumer reads from this same topic. RabbitMQ's topic is one matching rule of an exchange: a message only passes through it and gets filtered into some queues. The real storage place is the queue.

Another group of names really are synonyms. Kafka's topic, MQTT's topic, Redis's channel, NATS's subject, SignalR's Group: all five are nouns, the thing you subscribe to, and the range one broadcast reaches. RabbitMQ is not in this row: its messages are really stored in queues, with an extra exchange layer in front doing the distribution.

---

## Who writes Kafka's log? Does the consumer pull, or get pushed to?

Kafka is a log. So who writes this log? Do you append to it yourself?

The writer is the producer. One produce call, and Kafka appends that message to the tail of the topic. That action itself is "writing the log"; there is no separate step that writes the log. In the [URL shortener demo](article://url-shortener-demo), the redirect handler calls `kafka.Publish` to drop a click event into the `click-events` topic: one call, one append.

The consumer never touches the log itself. The only data it writes is its own offset, the bookmark that says "I have read up to entry N", stored inside Kafka. The log itself is shared by every consumer and none of them writes to it; progress is recorded per group. Two consumer groups reading the same log, one at entry 100 and the other at entry 30, do not affect each other. That is the subject of [The Log](article://the-log).

So does the consumer pull, or wait for the broker to push? **Kafka has only pull, no push.** The consumer sends fetch requests for data itself. Does that not turn into endless polling? It uses long poll: a fetch request can hang and wait, returning only when data arrives, and it can also ask for a minimum amount of data to accumulate before returning, which avoids empty polling. So it feels close to real time, but the consumer is in control: it pulls as fast as it can digest, slows down when it cannot keep up, and the broker has no way to force messages onto it.

RabbitMQ's default is the reverse: the broker pushes to the consumer, with a prefetch limit to stop it sending too much at once. Push is more immediate; pull gives better control over the flow.

---

## SQS is pull, so it is not pub/sub?

An old note of mine said "SQS is PULL, so it does not really count as pub/sub". SQS is indeed not pub/sub, but the reason is not that it uses pull.

Kafka is pull too, as the previous section just covered. But Kafka with two consumer groups is pub/sub. So "uses pull" and "counts as pub/sub" are two independent questions.

SQS is point-to-point. One consumer takes a message, deletes it, and it is gone. It cannot give every subscriber a copy, so it is not pub/sub.

| | Delivery | Push/pull |
|---|---|---|
| SNS | pub/sub | push |
| SQS | point-to-point | pull |
| Kafka | decided by consumer groups, both possible | pull |

The illusion comes from SQS happening to be both point-to-point and pull, and SNS happening to be both pub/sub and push.

---

## After sending, does it need to wait for the consumer's ack

In pub/sub the broker copies a message to every online subscriber and keeps nothing after sending. That sounds like it never needs an ack by nature. Redis pub/sub really is like that: it writes into every subscribed connection and is done. A subscriber that misses it at that moment never gets it later.

But when SNS pushes a message to an HTTP endpoint, it counts as delivered only after the other side returns 200, and it retries on failure. With MQTT QoS (Quality of Service) 1, the broker waits for a PUBACK from every subscriber it sends to. Both are pub/sub, both have acks.

So "ack or not" does not follow the delivery mode. It is another independent question: [delivery guarantees](chunk://delivery-guarantees). MQTT lays it out as three levels, chosen per message: QoS 0 sends and forgets (at most once), QoS 1 resends until a PUBACK arrives (at least once, duplicates possible), QoS 2 does a four step handshake (exactly once, the most expensive). Same protocol, same pub/sub, and the ack is optional: a setting adjustable per message, unrelated to whether the system is pub/sub or a queue.

What does change with the delivery mode is what the ack means. A queue's ack means "this one can be deleted": one consumer acks, and the message is gone for good. A pub/sub ack means "this subscriber got it": each subscriber is tracked separately, and A's ack does not affect the broker's resends to B. SNS having acks does not make it a queue. Its ack deletes nothing; it only stops the retries to that one subscriber.

What if the ack itself is lost? Do you need an ack for the ack? There is no end to it. Distributed systems do not try to know for certain that delivery happened. They make resending harmless: at-least-once plus an idempotent consumer, so ten duplicates have the same effect as one (see [idempotency](chunk://idempotency), [exactly-once](chunk://exactly-once)).

---

## Does Kafka read Redis on its own

In the demo, one click both increments the Redis counter and adds one click event to Kafka. But Kafka does not listen to Redis, or to anything else. The only way a message enters Kafka is that someone calls produce and writes it in. The flow of one click in the demo:

```
click → shortener handler
          ├─ Redis INCR clicks:<key>     (write A: live count)
          └─ kafka.Publish(click event)  (write B: drop it and move on, no waiting)
                → consumer pulls it out → ClickHouse (analytics)
```

Redis and Kafka do not know the other exists, so the handler has to write each of the two once: the Kafka event carries IP, user agent and timestamp for ClickHouse to analyze; Redis holds only a number, so even if some component did listen to Redis, it could not assemble those fields.

Laid out, the demo code is this (Go, segmentio/kafka-go):

```go
// write side: the redirect handler, one click writes to each side (redirect.go)
h.redis.IncrClick(ctx, shortKey)        // write A: Redis count +1
h.kafka.Publish(store.ClickEvent{       // write B: drop into Kafka, no waiting
    ShortKey: shortKey, Timestamp: time.Now(),
    IP: c.ClientIP(), UserAgent: c.Request.UserAgent(),
})

// Publish is fire-and-forget, redirect does not wait (store/kafka.go)
func (k *KafkaProducer) Publish(e ClickEvent) {
    b, _ := json.Marshal(e)
    go k.writer.WriteMessages(ctx, kafka.Message{Value: b})  // append to the tail of the topic
}

// read side: a separate process, pulls on its own (cmd/consumer/main.go)
r := kafka.NewReader(kafka.ReaderConfig{
    Topic:   "click-events",
    GroupID: "analytics-consumer",   // its own group, its own offset
})
for {
    msg, _ := r.ReadMessage(ctx)     // long poll: hangs and waits, returns when data arrives
    // parse → batch write into ClickHouse
}
```

Both writing and reading need the program to make the call: the handler calls `Publish`, the consumer calls `ReadMessage`.

"One system automatically watching another system's changes" does exist as a feature. It is called CDC (Change Data Capture): a separate component reads the database's internal log and turns every change into a message written to Kafka. But the one doing the reading is still that extra component. Kafka still only accepts whatever is written in.

---

## All four answered, laid out side by side

The main backend brokers laid out on the four questions: delivery (to one or to all), storage (delete or keep), push or pull (broker pushes or consumer pulls), and layer:

| Tool | Delivery | Storage | Push/pull | Layer |
|---|---|---|---|---|
| RabbitMQ | decided by exchange wiring, both possible | delete (cleared after ack) | push (prefetch throttles) | between backend services |
| Kafka | decided by consumer groups, both possible | log (kept, offset records progress) | pull (long poll) | between backend services |
| Kinesis Data Streams | same as Kafka | log | pull | between backend services |
| SQS | point-to-point | delete | pull | between backend services |
| SNS | pub/sub | none (gone once sent) | push | between backend services |
| NATS | pub/sub (queue groups can compete) | none (only JetStream keeps) | push | between backend services |
| WebSocket / SSE | no delivery mode, broadcast is yours to build | none | SSE pushes one way, WS both ways | the last stretch from server to browser |

Every tool is a combination of four answers and belongs to no single category. Kafka is called streaming, pub/sub and distributed log at the same time because each of the three names points at its answer to one question: keep (storage), groups broadcasting outward (delivery), and the log structure itself.

WebSocket and SSE (and SignalR) in the last row are not the same kind as the rows above. They are only the final segment closest to the client, and have nothing to do with the message queues discussed here: they store no messages, there is no delivery mode to speak of, and broadcasting has to be built on top (that is where SignalR's Group comes from). The SSE in the demo pushes every click to the dashboard, and it has no relation to the Kafka pipeline in the back end: SSE goes to the browser, Kafka goes to backend services. I used to put them in the same classification table as the brokers, and that is one more reason the table never worked.

Delivery guarantees (at most / at least / exactly once) sit outside the four questions. They do not place a system, because almost every product makes them adjustable: MQTT's three QoS levels, RabbitMQ's ack modes, Kafka's offset commit. Use the four questions to place a system, and ask about this setting separately when choosing one.

The finer tradeoffs between products are collected in the [Choosing a Queue](chunk://message-queue-comparison) chunk. Where messages get lost, and how to recover them, is in [the peak shaving article](article://queue-peak-shaving).
