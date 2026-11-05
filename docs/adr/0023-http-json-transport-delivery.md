# The HTTP JSON transport reports its drops, bounds its bytes and never outlives a process by itself

`createHttpTransport` is the delivery half of the Transport contract
(`0010-the-transport-contract-is-fire-and-forget.md`): it owns the delivery drops
(`0020-the-reporter-owns-policy-drops-and-the-transport-owns-delivery-drops.md`). Five decisions shape
how it drops, what it sends, when it waits, how many requests it makes and what it sends as the
page goes away.

## Drops are reported, by reason

An event the transport gives up on goes to `onDrop(events, reason)`. `DropReason` is `"queue-full"`,
`"too-large"`, `"retries-exhausted"`, `"rejected"`, `"unsendable"` (no `fetch` at send time, or a
throwing serializer), `"closed"` or `"unload-budget"`. With no `onDrop`, the transport warns once
per reason through an injectable `console`. A throwing `onDrop` is swallowed, because `send` never
throws.

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
and the estimated `maxBatchBytes` with it. An event whose estimated size alone exceeds
`maxBatchBytes` is a `"too-large"` drop when `send` would queue it. The request step measures the
real serialized body: one over `maxBatchBytes` is split in half and each half sent, and a lone event
whose real body is still over the limit is a `"too-large"` drop at request time. `maxBatchBytes`
therefore holds for the body that is sent, whatever serializer produced it.

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
on `fetch` to follow redirects. `Retry-After` is read as seconds or an HTTP-date. Each attempt —
resolving `headers`, then the `fetch` — is bounded by `requestTimeoutMs` (default 10 000) on the same
`Scheduler`: a hung attempt has its `fetch` aborted and counts as a retryable failure, so one
request in flight never holds the queue for longer than the attempts and waits `maxAttempts`,
`requestTimeoutMs` and `maxDelayMs` allow.

- **Concurrent requests.** A server answering 429 would receive the next batch immediately, and
  ordering between batches would be lost.
- **Per-batch pauses.** Each batch would learn the limit for itself, sending a request the server
  has already said it will refuse.
- **Retrying a 3xx.** A redirect `fetch` did not follow will not resolve by waiting.
- **Unbounded attempts.** A `fetch` that never answers, or a `headers` promise that never settles,
  would hold the single in-flight slot until `close`, and every later batch with it.

## Unload sends one keepalive request within the budget

On `pagehide`, or `visibilitychange` to `"hidden"`, the request in flight is aborted and the oldest
events, in flight then queued, go out as one `fetch` with `keepalive: true`, carrying the configured
headers and `contentType`. Its outcome is not reported. A page that comes back keeps using the
transport, and `close` removes the listeners once its flush is over.

The request carries the leading run of events that share the oldest event's Resource, because the
serializer takes one Resource per body. The run is cut to `maxBatchEvents` and to the largest prefix
whose serialized body fits both `maxBatchBytes` and the 64 KiB a document may have in flight under
`keepalive`, found by `largestFittingPrefix`. What the request leaves out is saved through the
`offline` queue as `"unload-budget"` when `offline` is on, and otherwise reaches `onDrop` as
`"unload-budget"`. A serializer that throws on the request's events, a missing `fetch` or a throwing
`headers` function drops them as `"unsendable"`. An async `headers` function delays the request until
it resolves. The `lifecycle` targets default to those detected on `globalThis`; `{}` watches none and
also stops the offline `online` replay.

- **`navigator.sendBeacon`.** A beacon cannot set headers, so an authenticated endpoint would refuse
  it, and a cross-origin `application/json` beacon is blocked. `keepalive` `fetch` carries both.
- **Several keepalive requests.** The budget is per document, so a second request would only be
  refused for the bytes the first took.
- **Sharing the budget with an OTLP sink or transport in the same document.** Each queue draws on the
  budget by itself, as ADR-0022 records for the OTLP pair, so the browser may refuse whichever
  request comes second. A coordinator across transports would add a shared registry and an ordering
  policy for a case an application can avoid by sending its error events one way, so none is built.

## Consequences

- A 429 just before exit makes `globalHandlers`' `flush(2000)` resolve `false`: a flush cuts the
  linger short but not a `Retry-After` wait.
- A `headers` function that always fails pauses the queue for each batch's retries.
- Every drop has a reason an application can count.
