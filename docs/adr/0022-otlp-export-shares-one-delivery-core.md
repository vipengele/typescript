# OTLP export shares one delivery core between the log Sink and the error Transport

This fixes the wire format and the delivery machinery that
`0010-the-transport-contract-is-fire-and-forget.md` left to the HTTP Transport, and applies them first
to the logger.

## One delivery core, package-internal

Batching, retry, flush, close and the unload drain live in one payload-generic module,
`src/delivery/` of `@vipengele/ts-core-observability`. It queues items with the Resource each was
written with, and takes the encoder for the body as a parameter, so it knows nothing of `LogRecord`
or `ErrorEvent`. The OTLP log Sink of `./logger` uses it, and the HTTP Transport for the Reporter in
`./errors` uses the same core. Retry is built on `@vipengele/ts-core-resilience`.

Its defaults follow the OpenTelemetry batch processor: a queue of 2048 items, batches of 512, a batch
every 5 s. A batch is retried up to 5 attempts with full-jitter exponential backoff from 1 s to 30 s,
10 s per attempt. A network error, a timeout, and a 429, 502, 503 or 504 response are retryable, and
`Retry-After` (seconds or an HTTP date) sets the wait. One export is in flight at a time. Items that
leave without delivery are counted by reason: `queue-full`, `rejected`, `retries-exhausted`,
`closed`, `unload-budget`. `flush` cuts a backoff short and waits up to its timeout; `close` flushes,
drops what remains as `closed` and turns later writes into no-ops.

## One wire format, one encoder

Both entry points export OTLP/HTTP JSON to `/v1/logs`. An Error Event goes out as an OTLP log record
as well, so a collector receives exceptions and logs on one endpoint, in the mapping of
`0007-the-log-record-and-error-event-data-model.md` and `0008-opentelemetry-is-an-opt-in-entry-point.md`.
The encoder in `src/otlp/` has one entry point per source type. Records are grouped by Resource value,
then by category, which becomes the instrumentation scope; the schema URL is OpenTelemetry semantic
conventions 1.37. Only `src/otlp/encode-logs.ts` knows the shape of a `LogRecord`.

The delivery core is built for two sources, logs and error events, though only logs use it so far.
Fixing the error Transport's wire format in the same decision keeps the core from being fitted to
logs alone.

## The exporter Sink owns its lifecycle

`createOtlpLogSink` returns an `OtlpLogSink`, which is `Sink & { flush(timeoutMs?), close(timeoutMs?) }`.
The `Sink` interface, the provider and the `vipengele.logger.provider.v1` slot protocol
(`0005-logging-is-configured-through-a-shared-default-provider-and-a-builder.md`) stay as they are, and a host that wants to drain at exit holds the sink it built and
awaits `close()`. The sink installs no Node exit hook, because a hook cannot await.

## Location

Only the public sink lives in `src/logger/`. The encoder (`src/otlp/`) and the core (`src/delivery/`)
are internal and unexported, because `./errors` will import them and `./logger` and `./errors` never
import each other.

## Unload sends one keepalive request

On `pagehide`, or `visibilitychange` to `hidden`, the core sends the largest oldest prefix of its
queue that fits the 64 KiB a document may have in flight under `keepalive`, found by doubling then
bisecting, as one `fetch` with `keepalive` and the configured headers. The remainder is dropped as
`unload-budget`.
There is no `sendBeacon` fallback: a beacon cannot set headers, so an authenticated collector refuses
it, and a cross-origin beacon with an `application/json` body is blocked by the browser.

The offline IndexedDB queue of ADR-0010 is deferred. A queue added later attaches through `onDrop`,
which reports every dropped item, without a change to the core's contract.

## Considered options

- **`flush` and `close` on `Sink`, or on the provider.** Every Sink, the console and test sinks
  included, would carry methods most cannot meaningfully implement, and the slot protocol shared by
  every resolved copy of the package would change.
- **Several keepalive requests on unload.** The 64 KiB budget is per document, so a second request
  competes with the first for the same bytes and either may be refused.
- **`sendBeacon` as a fallback.** It sends no headers and blocks cross-origin JSON, so it fails
  exactly where an authenticated collector is used.
- **A core for each entry point.** Retry, backoff and the unload budget would be written twice and
  drift apart.
- **OTLP protobuf.** It needs a generated encoder and a larger bundle for a payload JSON carries
  within the same collector contract.
- **A Node exit hook that flushes.** An exit hook is synchronous, so it cannot wait for the network.
