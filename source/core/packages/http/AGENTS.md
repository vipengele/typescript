# @vipengele/ts-core-http

HTTP client over `fetch`. Entry points: `.` (everything, errors included) and `./errors`. Run commands
from `source/core` (`pnpm build`, `pnpm type-check`, `pnpm test`, `pnpm lint`, `pnpm format:check`).
The decisions are in ADR-0029 (`0029-http-client-is-a-fetch-filter-chain.md`) and, for the resilience
filters, ADR-0030 (`0030-http-resilience-filters.md`) and, for the OAuth2 filter, ADR-0031
(`0031-oauth2-filter-single-flight-refresh-and-replay-once.md`).

## Errors (`src/errors/http-errors.ts`)

- `HttpError` is an abstract class extending `VipengeleError`. `HttpStatusError` (`http.status`) and
  `HttpConfigError` (`http.config`) fix `code` to an exported `*_ERROR_CODE` constant.
- Every concrete guard is `value instanceof Error && code === CODE`, anchored to `Error` (ADR-0002).
  `isHttpError` matches any string `code` starting with `http.`.
- `HttpStatusError` takes `({ method, url, response }, options?)`. It stores `url` after `redactUrl`
  and defines `response` non-enumerable, so logging the error never walks into the response.

## Package layout

- `src/index.ts` is the root barrel; `src/errors/index.ts` is `./errors`. `tsup.config.ts` has one
  entry per export and `package-exports.test.ts` fails when an `exports` key and a tsup entry disagree.
- `client.ts` holds `HttpClient` and `HttpClientBuilder`. The builder is mutable and `build()` takes a
  snapshot; `extend()` seeds a new builder from a client. `compileChain` runs at `build()`, so a tie
  error surfaces there.
- `request-builder.ts` holds the immutable `RequestBuilder` and its terminals. The status conversion
  happens there, after the chain returns; `send` converts only under `throwOnError`, `json`, `text`
  and `void` always, `exchange` never.
- `filter.ts` holds `Filter`, `filter()` (validates and freezes), `Next` and `Order`. `chain.ts` holds
  `sortFilters` (ascending by `order`, registration order among ties, a tie needs `allowsOrderTie` on
  every filter at that order), `compose` and `compileChain`.
- `context.ts` holds `HttpContext`. `attempt` is 1 for the root context and one more per `fork()`;
  under the retry filter it is the retry policy's attempt number. `fork()` copies the URL and headers
  and shares the body, signal and attributes. The internal `createAttemptContext(source, attempt)` makes
  the same copy for a given attempt number from `source`'s public fields only. `replayable` is read live from `request.body`. `markSent(body)`/`wasSent(body)`
  read the realm-wide record of dispatched one-shot bodies: one `WeakSet` on `globalThis` under
  `Symbol.for("vipengele:http:sent-one-shot-bodies")`, created on first access and shared by every
  resolved copy of the package.
- `dispatch.ts` calls `ctx.fetch(url.href, init)` and guards one-shot bodies (an async iterable goes
  through `toReadableStream` in `body.ts`, `duplex: "half"`, and any second dispatch of the same
  object — from a fork, another terminal call, a derived builder or another client — rejects with
  `HttpConfigError` before `fetch` is called). `resolveFetch` calls an injected `fetch` as a plain
  function (`this` undefined) and the default as `globalThis.fetch(...)`, a method of `globalThis`,
  read at each call. `dispatch` records the request object it sent for each response in a
  module-level `WeakMap`, read through `dispatchedRequest`, so a status error and the empty-body rule
  describe the request that produced the response (a forked one included), or the root request when
  a filter answered without dispatching.
- `url.ts` holds `resolveUrl`, the `baseUrl` join. A resolved URL with a username or password, from
  the input or the base, throws `HttpConfigError` with the URL passed through `redactUrl`.
  `http-response.ts` holds `HttpResponse` and the empty-body rule (204, 205, `HEAD`, zero-length
  body gives `undefined`).
- `src/resilience/` holds the resilience filters (ADR-0030), exported from the root only:
  - `predicates.ts`: `defaultIsFailure`, `defaultRetryPredicate`, `RetryNonIdempotent` and
    `HttpResilienceAttributes` (`Symbol.for` keys).
  - `retry-filter.ts`: `retryFilter`, a fresh `createAttemptContext` per attempt from the untouched base,
    cancelling discarded responses and recording the attempts.
  - `circuit-breaker-filter.ts`: `circuitBreakerFilter`, per-call `isFailure`, records the circuit state.
  - `rate-limiter-filter.ts`: `rateLimiterFilter`.
  - `timeout-filter.ts`: `timeoutFilter`, sets the received context's signal and cancels a late response.
  - `bulkhead-filter.ts`: `bulkheadFilter`.
  - `resilience-filters.ts`: `resilienceFilters`, which reads `registry.kinds()` once; `builder.resilience()`
    in `client.ts` replaces the set.
- `src/auth/` holds the OAuth2 filter (ADR-0031), exported from the root only: `token.ts` (the
  `OAuth2Token`, `OAuth2TokenRequest`, `OAuth2TokenSource` and `OAuth2TokenStore` types),
  `client-credentials.ts` (`clientCredentials`) and `oauth2-filter.ts` (`oauth2Filter` at `Order.AUTH`;
  `builder.oauth2()` in `client.ts` is `filter(oauth2Filter(options))`). `OAuth2TokenRefusedError`
  (`http.oauth2-token-refused`) and `OAuth2TokenError` (`http.oauth2-token`) live in `errors/http-errors.ts`.
  Invariants:
  - The token request goes through the raw `ctx.fetch`, never `next`, so no filter sees it.
  - No token value, secret or response content reaches an error message or its `cause`; a `cause` is
    kept only for a thrown `fetch` error or an error from a custom source.
  - A 401 refreshes only when `store.get()?.accessToken` still equals the rejected access token, a
    string compare, never an object identity compare.
  - The store is never cleared; a rejection is remembered in the filter.
  - The single-flight promise is cleared in `finally`, and a failure is not cached.
  - A replay happens at most once and never for a non-replayable body.
  - The access token is checked against the `b64token` charset before `store.set` and before every
    `headers.set`.
- Dependencies are `@vipengele/ts-core-common`, `@vipengele/ts-core-redaction` and
  `@vipengele/ts-core-resilience`, resolved through their built `dist/`. The package does not depend on `@vipengele/ts-core-observability` (ADR-0029).
