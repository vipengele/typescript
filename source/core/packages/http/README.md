# @vipengele/ts-core-http

An HTTP client for the browser and Node, built on `fetch`: an immutable request builder, an ordered
chain of filters for cross-cutting behaviour, and typed errors.

| Entry point | What it holds |
|-------------|---------------|
| `@vipengele/ts-core-http` | `HttpClient`, `filter`, `Order`, `oauth2Filter`, `clientCredentials`, `isOneShotBody` and the types, plus the errors |
| `@vipengele/ts-core-http/errors` | `HttpStatusError`, `HttpConfigError`, `OAuth2TokenRefusedError`, `OAuth2TokenError` and their guards |

```sh
pnpm add @vipengele/ts-core-http
```

Runs in the browser and in Node 24+. ESM only, side-effect free. It sends through `fetch` and has
no HTTP dependency; the decisions behind it are in
[ADR-0029](../../../../docs/adr/0029-http-client-is-a-fetch-filter-chain.md).

## Quick example

```ts
import { HttpClient, clientCredentials } from "@vipengele/ts-core-http";

const client = HttpClient.builder()
  .baseUrl("https://api.example.com")
  .oauth2({
    source: clientCredentials({
      tokenUrl: "https://auth.example.com/token",
      clientId: "my-client",
      clientSecret: "my-secret",
      scope: ["read"],
    }),
  })
  .build();

const result = await client.get("/things").json<{ ok: boolean }>();
```

A request builder is immutable: `header`, `query`, `json(body)`, `body`, `signal` and `attribute`
each return a new builder, and nothing is sent until a terminal is called. Each terminal call sends
the request again. A header set on the request wins over a client header of the same name.

## OAuth2

`builder.oauth2(options)` adds an `oauth2Filter`, a filter named `"oauth2"` at `Order.AUTH`. It
sends `Authorization: Bearer <token>`, keeps the token, refreshes it when it goes stale and recovers
from a token the server rejects. The decisions are in
`docs/adr/0031-oauth2-filter-single-flight-refresh-and-replay-once.md`.

- `authorize(request)` chooses the requests that get a token. Through `builder.oauth2()` it is
  optional and defaults to the requests whose URL has the `baseUrl`'s origin, so a request to an
  absolute URL on another host goes without the token. The `baseUrl` is read when `build()` runs, so
  `.baseUrl()` may come before or after `.oauth2()`; `build()` throws an `HttpConfigError` when
  neither a `baseUrl` nor `authorize` is given. `oauth2Filter(options)` used on its own knows no
  `baseUrl` and requires `authorize`. `authorize: () => true` sends the token with every request. A
  request that already carries an `Authorization` header is passed through untouched: the caller's
  header wins.
- `clientCredentials({ tokenUrl, clientId, clientSecret, scope?, params?, authentication? })` is the
  built-in token source for the client-credentials grant. `scope` is a string or an array joined with
  spaces, `params` adds form parameters such as `audience`. The client authenticates with an
  `Authorization: Basic` header by default (RFC 6749 section 2.3.1); `authentication: "body"` sends
  `client_id` and `client_secret` as form parameters instead. A `tokenUrl` with userinfo or an empty
  `clientId` throws an `HttpConfigError`. A response without `expires_in` gives a token valid until a
  server rejects it; a `token_type` other than `Bearer` fails.
- A custom source implements `OAuth2TokenSource` (`getToken({ fetch, signal, clock, reason })`,
  resolving `{ accessToken, expiresAt? }` with `expiresAt` in epoch milliseconds on that `clock`), and
  a custom store `OAuth2TokenStore` (`get()` and `set(token)`), passed as `source` and `store`. The
  default store is in memory and belongs to one filter. The token request goes through the request's
  own `fetch`, so no filter sees it.
- A token turns stale `refreshSkewMs` before `expiresAt` (30 000 by default), at most half of the
  lifetime left when the filter first sees it, so a short-lived token is not refreshed on every
  request. One refresh runs at a time and every request that needs a token waits for it; a request
  whose own signal aborts stops waiting without cancelling the refresh. A refresh is aborted after
  `refreshTimeoutMs` (30 000 by default) and fails with an `OAuth2TokenError`; the next request
  starts a new one. The `clock` and `scheduler` options replace `systemClock` and `systemScheduler`.
- A 401 marks its token as rejected, cancels the response body, obtains a token (refreshing only
  when the store still holds the rejected one) and sends the request again, once. A 401 to that
  second request is returned as it is. A request whose body can be sent only once is not sent again:
  its 401 is returned and the next request refreshes. The store is never cleared. The replay goes
  through the retry filter again with a fresh budget.
- The filters raise two errors, both reached through the root and `./errors`.
  `OAuth2TokenRefusedError` (`status`, `error`) means the token endpoint answered 400 or 401;
  `OAuth2TokenError` is every other failure and has a `cause` only for a thrown `fetch` error or an
  error from a custom source. Their messages carry the redacted token URL and a status, never a
  secret, a token or the endpoint's response; a token that is not a valid bearer token fails
  without its value.

Every client built from `extend()` of one client shares its filter, so it shares the token and the
in-flight refresh. The shared filter keeps the origin the first client was built with, even when the
extension sets another `baseUrl`; calling `.oauth2()` on the extension builds a new filter for it.

## Terminals

| Terminal | Resolves with | Status 400 and above |
|----------|---------------|----------------------|
| `send()` | the raw `Response` | `HttpStatusError` only when the client sets `throwOnError(true)`; off by default |
| `exchange()` | an `HttpResponse` (`status`, `ok`, `headers`, `raw`, `json()`, `text()`, `discard()`) | never raises |
| `json<T>()` | the parsed body | always `HttpStatusError` |
| `text()` | the body as a string | always `HttpStatusError` |
| `void()` | nothing; the body is cancelled unread | always `HttpStatusError` |

`json()` and `HttpResponse#json()` resolve `undefined` for an empty body: status 204 or 205, a `HEAD`
request or a zero-length body. The status conversion happens once, after the filter chain returns,
so a filter always sees the response. A failing response's body is left unread. A caller who catches
`HttpStatusError` owns `error.response` and should read or cancel its body (`await
error.response.body?.cancel()`): in Node an unread body holds its connection until garbage
collection, so a run of failing responses can exhaust the pool. `HttpStatusError`
redacts its `url` with `redactUrl` and keeps `response` non-enumerable.

## Filters and `Order`

A filter has a `name`, an `order` and `handle(ctx, next)`. Filters run in ascending `order`: lower is
outermost, seeing the request first and the response last. `next()` runs the rest of the chain with
the same context, `next(ctx)` with another, and calling it again reruns everything downstream.

| `Order` | Value |
|---------|-------|
| `OBSERVABILITY` | 100 |
| `AUTH` | 200 |
| `RETRY` | 1000 |
| `CIRCUIT_BREAKER` | 1100 |
| `RATE_LIMITER` | 1200 |
| `TIMEOUT` | 1300 |
| `BULKHEAD` | 1400 |
| `ATTEMPT` | 2000 |

Adding a filter with the name of an existing one replaces it in place; `removeFilter(name)` removes
one. Two filters may share an order only when every filter at that order sets `allowsOrderTie`;
`build()` throws an `HttpConfigError` naming both otherwise. `ctx.attempt` is 1 for the root context
and one more for each `ctx.fork()`; under the retry filter each attempt's context carries the retry
policy's attempt number instead.

## Resilience

The five resilience filters wrap the policies of `@vipengele/ts-core-resilience` at their `Order`
bands, so a chain of them nests the way the registry's pipeline does. `builder.resilience(registry,
name)` adds those the registry configures or holds for `name`:

```ts
import { HttpClient } from "@vipengele/ts-core-http";
import { createRegistry } from "@vipengele/ts-core-resilience";

const registry = createRegistry((builder) =>
  builder.configure("retry", "api", { maxAttempts: 4 }).configure("timeout", "api", { durationMs: 2_000 }),
);

const client = HttpClient.builder().baseUrl("https://api.example.com").resilience(registry, "api").build();
```

The kinds are read and the policies resolved once, when `resilience()` runs. A later call replaces
the whole set. Without a registry, add the filters one by one: `retryFilter(policy)`,
`circuitBreakerFilter(policy)`, `rateLimiterFilter(policy)`, `timeoutFilter(policy)` and
`bulkheadFilter(policy)`, or `resilienceFilters(registry, name, { kinds })` for an array to pass to
`filter(...)`.

- A failure is a thrown error, a status of 500 or above, 408 or 429 (`defaultIsFailure`). Pass
  `isFailure` to replace the rule for the retry and the circuit breaker. A failing status is still a
  `Response`: when the attempts run out the last one is returned, and the terminal converts it.
- The retry repeats only an idempotent method (`GET`, `HEAD`, `OPTIONS`, `TRACE`, `PUT`, `DELETE`).
  For another, set the `RetryNonIdempotent` attribute to `true` (`.attribute(RetryNonIdempotent,
  true)`) or send an `Idempotency-Key` header. It never retries a refusal (`CircuitOpenError`,
  `RateLimitExceededError`, `BulkheadFullError`), an `HttpConfigError`, a one-shot body, an aborted
  signal; it does retry an `OperationTimeoutError`. `defaultRetryPredicate(base, options)` builds the
  predicates if you drive a `RetryPolicy` yourself.
- `Retry-After`, in delta-seconds or as an HTTP-date, replaces the backoff for that wait. A delay
  above `maxRetryAfterMs` (30 000 by default) ends the retries and the caller gets that `Response`
  with its header. `clock` sets the time an HTTP-date is measured from.
- Each attempt runs on its own context, so `ctx.attempt` is the policy's attempt number and a
  mutation a filter makes does not reach the next attempt. The timeout filter bounds one attempt
  under the retry and the whole call without it.
- A `Response` that is discarded (a retried attempt's, one arriving after a timeout) has its body
  cancelled; one that is returned keeps it.
- The filters record state on the call's attributes under `HttpResilienceAttributes.attempts` (the
  attempts made) and `HttpResilienceAttributes.circuitState`, which a filter further out can read.

The decisions are in `docs/adr/0030-http-resilience-filters.md`.

## One-shot bodies

A `ReadableStream` or an async iterable body can be sent once. `ctx.replayable` is `false` for one,
and `isOneShotBody(body)` answers the same question. An async iterable is wrapped in a
`ReadableStream` at dispatch, in both runtimes, and sent with `duplex: "half"`. The record of sent
bodies is realm-wide, shared by every attempt, terminal call, request builder and client, so a second
dispatch of the same object rejects with an `HttpConfigError` before `fetch` is called — whether it
comes from a retry, a second `send()` on the same builder or a derived one. A filter that retries, or
a caller that sends again, must supply a fresh body.

Streaming request bodies are limited by the platform, and the package does not work around it:
Chromium needs HTTP/2 or later, and Firefox and Safari do not support them.

## Joining `baseUrl`

An absolute input (a `scheme://` string or a `URL`) is used as it is. A relative input is joined to the
base path with exactly one `/`; the base's query and hash are dropped and the input's own are kept.
`..` segments are resolved after the join, so `client.get("../x")` can climb above the base path; this
is documented and not prevented. A protocol-relative `//host` and a relative input with no `baseUrl`
throw an `HttpConfigError` when the request is started.

A URL carrying credentials (`https://user:pass@host`) is refused with an `HttpConfigError`, whether it
is the `baseUrl` (refused by `.baseUrl(...)` itself) or an absolute request URL (refused when the
request is started); the message carries the URL through `redactUrl`. `fetch` rejects such a URL with
a `TypeError` that quotes it, password included. Send credentials in a header, from an auth filter such as `oauth2Filter`.

## Errors

```ts
import { isHttpStatusError } from "@vipengele/ts-core-http/errors";

try {
  await client.get("/orders/42").json();
} catch (error) {
  if (isHttpStatusError(error)) {
    console.log(error.status, error.method, error.url);
  }
}
```

| Error | `code` | Guard |
|-------|--------|-------|
| `HttpStatusError` (`method`, `url`, `status`, `response`) | `http.status` | `isHttpStatusError` |
| `HttpConfigError` | `http.config` | `isHttpConfigError` |
| `OAuth2TokenRefusedError` (`status`, `error`) | `http.oauth2-token-refused` | `isOAuth2TokenRefusedError` |
| `OAuth2TokenError` | `http.oauth2-token` | `isOAuth2TokenError` |
| `HttpError` (the base) | any `http.*` | `isHttpError` |

Guards match on `code`, never on class identity, so they hold across two resolved copies of the package.
