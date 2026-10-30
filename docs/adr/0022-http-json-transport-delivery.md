# The HTTP JSON transport reports its drops, bounds its bytes and never outlives a process by itself

`createHttpTransport` is the delivery half of the Transport contract
(`0010-the-transport-contract-is-fire-and-forget.md`): it owns the delivery drops
(`0020-the-reporter-owns-policy-drops-and-the-transport-owns-delivery-drops.md`). Four decisions shape
how it drops, what it sends, when it waits and how many requests it makes.

## Drops are reported, by reason

An event the transport gives up on goes to `onDrop(events, reason)`. `DropReason` is `"queue-full"`,
`"too-large"`, `"retries-exhausted"`, `"rejected"`, `"unsendable"` (no `fetch` at send time, or a
throwing serializer) or `"closed"`. With no `onDrop`, the transport warns once per reason through an
injectable `console`. A throwing `onDrop` is swallowed, because `send` never throws.

- **Silent drops.** An application could not tell a full queue from a dead endpoint, and the one
  component that knows why an event vanished would say nothing.
- **A warning per drop.** An endpoint that is down for an hour would turn every captured error into
  a log line, flooding the console the application is already using to find the problem.
- **A single undifferentiated drop callback.** Distinguishing back-pressure from a rejection the
  application can fix would mean parsing messages.

## The body is a Resource envelope, bounded in bytes

The default body is `{"resource": {defined keys}, "events": [...]}` as `application/json`. `serialize`
and `contentType` replace it. A batch never mixes Resources, and Resources are compared structurally
by a key built from the eleven reserved keys, because `Scope.resource()` returns a new frozen object
on every read. The queue measures an event as the UTF-8 length of its JSON and bounds `maxQueueBytes`
and the estimated `maxBatchBytes` with it. The request step measures the real body: one over
`maxBatchBytes` is split in half and each half sent. A single event over the limit is a `"too-large"`
drop. `maxBatchBytes` therefore holds for the body that is sent, whatever serializer produced it.

- **The Resource on every event.** Eleven keys repeated in each event multiply the payload by the
  batch size.
- **Comparing Resources by identity.** Every event would carry a distinct object, so no two events
  would ever share a batch.
- **Bounding only the estimate.** A custom serializer can produce a body of any size, so the limit
  would hold only for the default format.

## No `unref`, no exit hooks, capped waits

Every wait runs on an injected `Scheduler`. Timers are not `unref`'d and the transport registers no
exit hook. `maxDelayMs` (default 30 000) caps both backoff and `Retry-After`, and `lingerMs` defaults
to 1000. A process that must not lose events awaits `close()`; the exit-time flush of an unhandled
error stays with `globalHandlers`
(`0012-global-handlers-are-an-integration-with-a-required-exit-policy.md`).

- **`unref` on the timers.** A process with a queued event would exit without sending it, which is
  the loss the transport exists to prevent.
- **An exit hook in the transport.** Several transports would each decide when the process ends, and
  the exit policy is the application's.
- **Uncapped waits.** A `Retry-After` of a day would hold the queue and keep the process alive for a day.

## One request in flight, and a 429 pauses the queue

Batches go out one request at a time. A backoff or `Retry-After` wait holds back every batch behind
it. A 2xx is delivered; a network error, 408, 429 or 5xx is retried (`maxAttempts` 5, 1 s initial
delay, full jitter, capped at `maxDelayMs`); any other status, a 3xx included, is `"rejected"`, relying
on `fetch` to follow redirects. `Retry-After` is read as seconds or an HTTP-date.

- **Concurrent requests.** A server answering 429 would receive the next batch immediately, and
  ordering between batches would be lost.
- **Per-batch pauses.** Each batch would learn the limit for itself, sending a request the server
  has already said it will refuse.
- **Retrying a 3xx.** A redirect `fetch` did not follow will not resolve by waiting.

## Consequences

- A 429 just before exit makes `globalHandlers`' `flush(2000)` resolve `false`: a flush cuts the
  linger short but not a `Retry-After` wait.
- A `headers` function that always fails pauses the queue for each batch's retries.
- Every drop has a reason an application can count.
