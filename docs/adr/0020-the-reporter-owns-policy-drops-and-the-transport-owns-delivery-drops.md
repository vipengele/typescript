# The Reporter owns policy drops, the Transport owns delivery drops

An Error Event can be dropped for two different reasons. A policy drop answers *should this event be
reported*: it is outside the sample, it matches an ignored error, a processor withheld it, it repeats
the event before it, or too many events have been sent too recently. A delivery drop answers *can
this event be delivered*: the Transport's queue is full, or its retries are exhausted. The Reporter
owns every policy drop and the Transport owns every delivery drop. "The decision to drop" in the
Transport contract (`0010-the-transport-contract-is-fire-and-forget.md`) is the delivery drop only:
a Transport delivers every event it is handed, or drops it because it cannot.

## Stage order

`captureException` and `captureMessage` run an event through these stages, in this order:

1. **Environment gate.** `enabledEnvironments`
   (`0016-release-environment-and-runtime-context-are-resource.md`).
2. **Sampling.** `sampleRate`, a fraction from 0 to 1, keeps that share of events at random.
3. **Normalize.** The thrown value or message becomes an Error Event.
4. **`ignoreErrors`.** Matches the normalized event, before redaction.
5. **Enrich.** The event takes what the ambient Scope carries.
6. **Redaction.** The Reporter's redaction setting (`0011-redaction-presets-and-exceptions.md`).
7. **Processors.** Every processor added with `ReporterBuilder#addProcessor`, in the order added.
8. **`beforeSend`.** One slot; a later call replaces the earlier hook. It runs after every processor.
9. **Deduplication.**
10. **Rate limit.**
11. **Transport.** `send(event, resource)`.

Sampling runs before normalization, so an event outside the sample costs nothing beyond the gate.
`ignoreErrors` runs after normalization because it matches the event's message and exception, which
exist only once the thrown value is normalized. Redaction runs before the processors, so a processor
sees already-redacted data, the same guarantee the logger gives its processors
(`0017-logger-processors-fail-closed-after-built-in-redaction.md`). Deduplication and the rate limit
run last, on the event the Transport would receive, so a processor or `beforeSend` that drops or
rewrites an event changes what they count.

A processor and `beforeSend` have one public type, the shape of the logger's `LogProcessor`:

```ts
type ErrorEventProcessor = (event: ErrorEvent) => ErrorEvent | null;
```

`null` drops the event. A processor or `beforeSend` that throws drops the event silently.

Every drop, at any stage, still returns the event's id; `captureException` and `captureMessage`
never throw. A dropped event never blocks the `"exit"` sequence of a Global Handler
(`0012-global-handlers-are-an-integration-with-a-required-exit-policy.md`): its flush and exit run
whether or not the event reached the Transport.

## Deduplication and the rate limit are on by default

`sampleRate` defaults to 1 and `ignoreErrors` to `[]`, so neither drops anything unless configured.
Deduplication and the rate limit are on: `dedupe(false)` and `rateLimit(false)` turn them off.

Deduplication compares an event with the last event that passed it, with no time window. Two events
are duplicates when their fingerprints are equal, or when their message, the top exception's type
and message, and its stack frames are equal. Attributes are not part of the comparison: the same
error raised in a loop with a different counter attribute is still one error.

The rate limit is a token bucket with a burst of 60, refilled at 60 tokens per minute. It refills
lazily from the event's `time` when an event reaches it, so it reads the clock no second time and
runs no timer. Each event it passes takes one token; an event that finds the bucket empty is dropped.

The rate limit protects the backend, not the client. A flooded event still pays for normalization,
enrichment, redaction, the processors and `beforeSend` before the limiter drops it. Only tokens are
saved, never the pipeline's work.

## Unhandled events bypass deduplication and the rate limit

An event whose `mechanism.handled` is `false` skips deduplication and the rate limit, and consumes no
token. It still goes through the environment gate, sampling, `ignoreErrors`, the processors and
`beforeSend`. Without the bypass a render loop that empties the bucket with handled errors would drop
the `uncaughtException` report that follows it, the one event the application most needs to see.

## Considered options

- **Transport-side drops.** Sampling, deduplication and rate limiting inside the Transport would be
  reimplemented by every Transport, and an application would report a different set of events
  depending on which Transport it chose: the test transport would not see what the HTTP transport
  sends. Policy belongs to what the application configures once, the Reporter.
- **Split ownership.** The Reporter samples and filters while the Transport deduplicates and rate
  limits, say. Configuring one policy would take two builders, and the question of why an event was
  never reported would have two places to look. Each Transport would still reimplement its half.
- **Opt-in deduplication and rate limiting.** Every application that never read the option would
  send a render loop's thousands of identical errors to the backend. The defaults follow the
  logger's redaction: the safe behaviour is the one a caller gets without asking, and turning it off
  is one call.

## Consequences

- A Transport never decides whether an event is worth reporting; a Transport that samples or
  deduplicates on its own duplicates a Reporter stage.
- An application that wants every handled event delivered calls `dedupe(false)` and
  `rateLimit(false)`.
- A burst of handled errors followed by an unhandled one delivers the unhandled one, at the cost of
  the bucket not bounding unhandled events at all.
