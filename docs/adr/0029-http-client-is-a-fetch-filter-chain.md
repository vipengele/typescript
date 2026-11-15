# The HTTP client is a fetch filter chain

`@vipengele/ts-core-http` sends requests through `fetch` and shapes every request on the way out and
every response on the way back with an ordered chain of filters. This records the choices that
fix the package's behaviour: the transport, the chain and its ordering, the dependencies it
refuses, what each terminal does with a status, how a URL is joined and how a one-shot body is
guarded.

## Decisions

1. **`fetch` is the only transport.** The package dispatches through the realm's `fetch`, or one
   injected with `fetch(...)` on the builder. The default reads `globalThis.fetch` at each send, so
   a stub installed after the client is built is the one used, and it is called as a plain function
   because a native `fetch` called as a method of anything but `window` throws "Illegal invocation".
   *Rejected: axios, or an adapter layer over several transports.* axios is a runtime dependency,
   uses XHR in the browser and brings an interceptor model that would duplicate the filter chain.
   An adapter layer reimplements `fetch`'s semantics per transport for no caller the platform does
   not already serve.

2. **A request runs through a chain of filters ordered by a numeric `order`; lower is outermost.** A
   `Filter` has a `name`, an `order` and `handle(ctx, next)`; calling `next` more than once reruns
   everything downstream, which is how a retry filter works. The public `Order` constants name the
   bands the built-in policies occupy: `OBSERVABILITY` 100, `AUTH` 200, `RETRY` 1000,
   `CIRCUIT_BREAKER` 1100, `RATE_LIMITER` 1200, `TIMEOUT` 1300, `BULKHEAD` 1400 and `ATTEMPT` 2000.
   Retry sits outside the breaker, limiter, timeout and bulkhead so each attempt passes through
   them; the timeout sits inside the retry so it bounds one attempt; observability and auth sit
   outside everything so they see the logical call once. Gaps between the bands leave room for a
   caller's own filters. Adding a filter whose name is already present replaces it in place.
   *Rejected: ordering by registration alone.* The chain's meaning would depend on the order of
   builder calls, and a library adding a filter could not place it relative to a retry without
   knowing where the application put the retry.

3. **Two filters may share an `order` only when every filter at that order sets `allowsOrderTie`.**
   `build()` checks it and throws an `HttpConfigError` naming the two filters. Ties among the
   agreeing filters keep registration order. This departs from the wording "unless a filter has
   `allowsOrderTie`", which lets one opt-in filter license a tie with a filter that never agreed to
   share its slot. With the all-must-opt-in rule a new filter cannot squeeze in beside a built-in
   that never agreed to share its slot. *Rejected: any-one-opts-in, and refusing every tie.* The
   first lets the newcomer decide for the incumbent; the second forbids two filters that are
   genuinely order-independent from sharing a band.

4. **The package does not depend on `@vipengele/ts-core-observability`.** Observability would
   arrive as a filter a caller writes, in the `OBSERVABILITY` band. The error reporter's HTTP
   transport (`0010-the-transport-contract-is-fire-and-forget.md`) is the other direction of that
   edge, and a dependency from the HTTP client to the observability package would make the two
   circular. The package depends on `@vipengele/ts-core-common` (`VipengeleError`) and
   `@vipengele/ts-core-redaction` (`redactUrl`) only. *Rejected: a built-in logging filter.* It
   would force the cycle.

5. **Terminals differ in what a status means, and the conversion happens after the chain.**
   - `send()` resolves with the raw `Response`; it raises `HttpStatusError` for status 400 and
     above only when the client sets `throwOnError`, which is off by default.
   - `exchange()` resolves with an `HttpResponse` whatever the status and never raises on it.
   - `json()`, `text()` and `void()` always raise `HttpStatusError` for status 400 and above,
     whatever `throwOnError` says.
   - An empty body reads as `undefined` in `json()`: status 204 or 205, a `HEAD` request or a
     zero-length body.
   - The conversion runs once, after the chain returns, at the outermost edge. A filter in the
     chain always sees the response, so a retry filter can inspect a 503 and an auth filter a 401
     without catching anything. The converted error leaves the body unread and the package never
     cancels it. A caller who catches `HttpStatusError` owns `error.response` and should read or
     cancel its body (`await error.response.body?.cancel()`): in Node an unread body holds its
     connection until garbage collection, so a run of failing responses can exhaust the pool.
   - `HttpStatusError.url` is passed through `redactUrl` before it is stored, so userinfo and
     secret query parameters never reach a log line, and its `response` is non-enumerable so
     serializing or logging the error does not walk into the response.
   *Rejected: throwing on a status inside the dispatch.* The chain would see a rejection where it
   should see a response, and every retry or auth filter would need a `catch` to read the status.

6. **A relative URL is joined to `baseUrl` by a fixed rule.**
   - An absolute input (a `scheme://` string or a `URL` object) is used as it is.
   - A relative input is joined to the base path with exactly one `/` between them.
   - The base's query and hash are dropped; the input's own are kept.
   - `..` segments are resolved by the URL parser after the join, so a path can climb above the
     base path. This is documented and not prevented: a client does not know which part of the
     base is a boundary, and the path comes from the caller's own code.
   - A protocol-relative `//host` input and a relative input without a `baseUrl` raise
     `HttpConfigError` synchronously, when the request is started.
   *Rejected: `new URL(input, base)`.* A leading `/` in the input would replace the base path
   rather than extend it, and the base's trailing slash would change the result.

7. **A one-shot body is sent at most once per logical call.**
   - A `ReadableStream` or an async iterable is consumed by its first send. `HttpContext.replayable`
     reports whether the current body can be sent again, read live from `request.body` so a filter
     that swaps the body sees the change.
   - An async iterable is wrapped in a `ReadableStream` at dispatch, in both runtimes: a browser
     `fetch` given an async iterable stringifies it to `"[object Object]"` without failing.
   - A one-shot body is sent with `duplex: "half"`.
   - The sent-state belongs to the logical call and is shared by every `fork` of its context. A
     second dispatch of the same one-shot object, by any attempt, rejects with `HttpConfigError`
     before `fetch` is called, so a retry filter that forgets to supply a fresh body fails loudly
     instead of sending an empty or closed stream.
   - Streaming request bodies are limited by the platform: Chromium needs HTTP/2 or later, and
     Firefox and Safari do not support them. The package documents this and does not work around
     it, for instance by buffering, since buffering would defeat the reason to stream.
   *Rejected: buffering one-shot bodies so every body is replayable.* It removes the streaming
   upload the caller asked for and holds an unbounded body in memory.

## Consequences

- A filter is the one extension point. Retry, circuit breaking, rate limiting, timeouts and
  bulkheads from `@vipengele/ts-core-resilience` and a caller's own logging or auth are all
  filters placed by `Order`.
- A filter that retries must give each attempt a replayable body or a fresh one-shot body.
- A caller who wants a status as an error from `send` sets `throwOnError`; one who wants to branch on
  a status uses `exchange`.
