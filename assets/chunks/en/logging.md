---
title: "Logging"
slug: logging
brief: "Structured logs plus a correlation ID: the first record you open when something breaks."
date: 2026-06-12
updated: 2026-10-18
revisions: 2
---

# Logging

> Something breaks in production. What is the first thing you go and read?

## Concrete events, one by one, with a timestamp

A log writes down what happened, one entry at a time, each with a timestamp. Of the three pillars of observability (log, metric, trace), the log has the finest grain. It records "at this moment, this specific thing happened".

Walk through one failed order. User 123 presses checkout at 3:42 pm and gets a 500. The request passed through the API gateway, the order service and the inventory service. Each service runs on 20 machines, 60 in total, and nobody knows which three handled this request.

A plain text log looks like this: `2026-10-17 15:42:07 ERROR insufficient stock for sku 889`. If the logs stay on the 60 machines, you log into each one and grep, whatever the format, so the first step is to collect them in one place and query them there, in ELK or Loki. Once collected, a plain text log can only be matched line by line against the string `insufficient stock`. That match returns every out-of-stock error in that period, and this line has no user_id, so there is no way to tell which one belongs to user 123. A structured log outputs JSON instead: `{"ts":"15:42:07","level":"error","service":"inventory","user_id":123,"request_id":"a1b2c3","msg":"insufficient stock"}`. Every field can be a query condition, and `level=error AND user_id=123` finds this entry in one line.

The request_id field is the correlation ID. The API gateway generates `a1b2c3` when the request arrives, puts it in a header and passes it downstream. The order service and the inventory service both include the same id when they write their logs. Query `request_id=a1b2c3` and the lines from the three services line up into one sequence: gateway received at 15:42:06, order service created the order at 15:42:06, inventory service failed to deduct stock at 15:42:07. `user_id=123` plus this two-second window can also line them up, as long as 123 sent only one request in those two seconds. If he pressed checkout twice, the gateway and the order service each have two lines with `user_id=123`, both at 15:42:06, and there is no way to tell which line belongs to the failed request. Every request gets its own request_id, so querying `request_id=a1b2c3` returns only the three lines of the failed one.

Like a diary, every event written down in time order. Good for "what exactly happened at 3:42 pm"; for "the trend this month", look at metrics.

## The cost

Logging every request produces a huge volume, and storage is expensive. So logs get levels (debug / info / warn / error), only the necessary ones are kept, and a retention period is set.
