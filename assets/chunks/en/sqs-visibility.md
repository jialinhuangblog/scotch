---
title: "SQS Visibility Timeout"
slug: sqs-visibility
brief: "A message a worker takes is hidden, not deleted. Delete it when done; otherwise it reappears for another worker."
date: 2026-07-12
article: sns-sqs
---

# SQS Visibility Timeout

> One queue, three workers taking messages at the same time. How do you guarantee a message goes to only one worker, and that it does not simply vanish if the worker dies halfway through?

## Taking is not deleting

An SQS message is not deleted when a worker reads it. After one worker takes a message, the message enters a period of "invisible time" (the visibility timeout, 30 seconds by default). During that time, other workers cannot see it and will not take it again.

When the worker finishes, it explicitly sends a delete back to the queue, and only then does the message really disappear. If the worker crashes midway and never sends the delete, the message reappears when the time is up, and another worker takes over.

```text
worker A takes #42  ──►  #42 invisible (others cannot see it within the timeout)
   ├─ finished, sends delete  ──►  #42 deleted, done
   └─ crashed midway, no delete  ──►  timeout reached, #42 reappears, worker B takes it
```

## This gives at-least-once

Invisibility plus reappearing after the timeout means a message does not vanish because a worker died. The cost is that the same message may be processed more than once: a worker finishes, crashes before the delete arrives, and the message gets taken once more after the timeout.

So SQS is at-least-once, not exactly-once. The consumer has to handle duplicates, usually through [idempotency](chunk://idempotency): processing the same message twice gives the same result as processing it once.

## How long to set the timeout

Too short, and the message reappears while the worker is still processing it, so another worker repeats the same work for nothing. Too long, and when a worker really dies, the message waits a long time before another worker takes over. The usual setting is "the longest one message takes to process" plus some margin. If processing time varies a lot, the timeout of a single message can be extended midway through processing.

---

The visibility timeout hands a message to only one worker at a time. When a worker dies, the message reappears after the timeout and goes to another worker. The cost is that the consumer has to handle duplicates itself.
