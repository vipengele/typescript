---
about: "the one-shot body record is realm-wide (globalThis Symbol.for slot), not per-call; the retry predicate checks base.replayable and vetoes HttpConfigError because dispatch marks the body sent before fetch"
saw:
  - source/core/packages/http/src/context.ts
  - source/core/packages/http/src/dispatch.ts
  - source/core/packages/http/src/request-builder.ts
  - docs/adr/0029-http-client-is-a-fetch-filter-chain.md
  - source/core/packages/http/src/resilience/predicates.ts
  - source/core/packages/http/src/resilience/retry-filter.ts
  - source/core/packages/http/src/resilience/timeout-filter.ts
---
Correction: candidate 20261115-http-dispatch-one-shot-and-fetch-binding.md says one-shot bodies are marked in a
"per-call WeakSet that every fork() shares". That is now-false. `markSent`/`wasSent` use one WeakSet on
`globalThis[Symbol.for("vipengele:http:sent-one-shot-bodies")]` (context.ts:42-52,88-95); ADR-0029 decision 7 and
the AGENTS.md agree. `dispatchedRequests` is the opposite: a module-level WeakMap by design (dispatch.ts:104-110)
because writer (dispatch) and reader (request-builder.ts:203) are the same copy.

Consequences, verified in code:
- dispatch records the body BEFORE calling fetch (dispatch.ts:163), so even a network failure of attempt 1 consumes a stream body; attempt 2 rejects `HttpConfigError` (dispatch.ts:158-162) before fetch. resilience's default retry would retry that error, so `defaultRetryPredicate` (http/src/resilience/predicates.ts) returns false when `base.replayable` is false (context.ts, live from request.body) and for any `HttpConfigError`; a custom `shouldRetry` passed around it must keep both vetoes.
- `fork()` copies url/headers, SHARES body, signal and the attributes Map, attempt+1 (context.ts:71-75). `retryFilter` gives each attempt a fresh context from the untouched base through the internal `createAttemptContext` (context.ts), and `timeoutFilter` assigns the composed signal on the context it receives (the attempt's, under retry) and restores the caller's once `next` settles.
- Status conversion is after the chain (request-builder.ts:155-157 etc.); filters see raw Responses and the package never cancels a body, so `retryFilter` cancels every discarded Response body and `timeoutFilter` cancels one that arrives after the timeout.
- `dispatchedRequest(response)` reports the forked request that produced the response, falling back to the root (request-builder.ts:203); a filter that fabricates/caches a Response gets the root.
- HttpConfigError redaction: HttpConfigError has no URL field; url.ts passes the input through redactUrl in the message and deliberately attaches no `cause` for an unparseable URL (see candidate 20261115-http-url-config-errors-carry-no-cause). New config errors that mention a URL (e.g. an OAuth2 token endpoint) should do the same: `redactUrl` the text and never attach the platform TypeError as cause. HttpStatusError redacts via redactUrl and keeps `response` non-enumerable (http-errors.ts:49-56).
- Credentials: a resolved URL with userinfo throws HttpConfigError (url.ts per ADR-0029 decision 6); an OAuth2 filter must therefore send client credentials in a header/body, never userinfo on the token URL.
