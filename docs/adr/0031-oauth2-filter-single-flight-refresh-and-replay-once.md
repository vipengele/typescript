# The OAuth2 filter refreshes single-flight and replays a 401 once

`@vipengele/ts-core-http` sends `Authorization: Bearer <token>` from `oauth2Filter`, a filter at
`Order.AUTH` (`0029-http-client-is-a-fetch-filter-chain.md`) that sits outside the resilience filters
(`0030-http-resilience-filters.md`). This records how it acquires and keeps a token, what a 401 does,
and the seams a caller can replace.

## Context

A token has a lifetime, an issuer can refuse to give one, and a server can reject one that looks
valid. Many requests run at once, so an expired token must cost one token request, not one per
request. A token request is itself an HTTP call that must not pass through the filter that is waiting
for it, and a failure must not put a secret or a token into a message, a `cause` or a log line.

## Decisions

1. **A token source and a token store are the two seams.** `OAuth2TokenSource.getToken(request)`
   resolves an `OAuth2Token` (`accessToken`, optional `expiresAt` in epoch milliseconds). Its request
   carries the filter's raw `fetch`, a `signal` the filter owns, the filter's `clock` and a `reason`
   (`"initial"`, `"expired"` or `"rejected"`), so `expiresAt` and the staleness check share one clock.
   `OAuth2TokenStore` is `get()` and `set(token)`; the default is in memory and belongs to one filter
   instance. `clientCredentials` is the built-in source.
   *Rejected: a subclassed token manager.* A class to extend ties a caller to its internals and to one
   copy of the package; two small interfaces can be wrapped, shared and tested with a plain object.

2. **Two typed errors, each with a code and a guard.** `OAuth2TokenRefusedError`
   (`http.oauth2-token-refused`) means the endpoint answered 400 or 401; it holds `status` and the
   OAuth `error` code, and drops `error_description`. `OAuth2TokenError` (`http.oauth2-token`) is
   everything else. It keeps a `cause` only for a thrown `fetch` error or an error from a custom
   source; a malformed body, a bad shape, a bad `expires_in`, a `token_type` other than Bearer and an
   unusable access token have no `cause`. Messages carry the `redactUrl`-ed token URL and the status,
   never a secret, a token or response content. The filter's own errors name `"the token source"` in
   place of a token URL, since it never sees the URL.

3. **A custom source's failure is classified, not passed through.** An error that passes either
   guard propagates as it is, any other rejection becomes an `OAuth2TokenError` with that `cause`, and
   a resolved value without a string `accessToken` becomes an `OAuth2TokenError` with no `cause`.

4. **The access token is validated against the RFC 6750 `b64token` charset.** The check runs before
   `store.set` and again before every `headers.set`, so a value a store hands back is checked too.
   `Headers.set` throws a `TypeError` that echoes an invalid value, and a token reaching an error
   message is the leak this closes.

5. **The store is read on every request and never cleared.** A refresh starts the single-flighted
   `source.getToken` and installs the result with `store.set`. A 401 refreshes only when
   `store.get()?.accessToken` still equals the rejected access token, compared as a string; otherwise
   the request replays with the current token. The rejection is remembered in the filter as that
   string, so the next refresh reports `reason: "rejected"`, and a successful refresh clears the
   remembered rejection.
   *Rejected: comparing token objects by identity.* A store that rebuilds objects, by structured
   clone or deserialisation, never matches and refreshes on every 401.
   *Rejected: clearing the store on a 401.* A store shared between filters or processes would be
   wiped for everyone, and one rejected request would force a refresh for all of them.

6. **Staleness is fixed when the filter first sees a token.** `refreshAt = expiresAt -
   min(refreshSkewMs, remaining / 2)`, with the remaining lifetime floored at 0, so a short-lived
   token is not refreshed on every request and one already expired when first seen is refreshed at
   once. A token without `expiresAt` is used until a 401. The default skew is 30 000 ms.

7. **One refresh runs at a time, bounded by a deadline.** The in-flight promise is cleared in
   `finally`, a failure is not cached, and the next request starts a new refresh. The refresh runs on
   an `AbortController` the filter creates and aborts after `refreshTimeoutMs` (30 000 by default) on
   `scheduler`, failing with an `OAuth2TokenError` without a `cause`. Each waiter races its own
   `request.signal` and rejects with that signal's reason; a request whose signal is already aborted
   rejects without starting a refresh. One caller's abort never cancels the shared refresh.
   *Rejected: a refresh bound to the starting request's signal.* The caller who happened to start it
   would cancel the token for every other waiter.
   *Rejected: an unbounded refresh.* A token endpoint that never answers would hang every request
   behind it.

8. **A 401 is replayed at most once.** The filter cancels the 401's body, obtains a token as in
   decision 5, forks the context, sets the new header on the fork and returns `next(fork)`. A second
   401 is returned with its body intact and its token is remembered as rejected. A refresh that throws
   here propagates its typed error. Replay applies to every method, since a 401 means the request was
   not processed. It re-enters the retry filter with a fresh budget, counts again against a shared
   circuit breaker, rate limiter and bulkhead, and `HttpResilienceAttributes.attempts` reflects only
   the replay.

9. **A 401 on a non-replayable body is returned untouched.** A one-shot body cannot be sent twice
   (a second dispatch throws `HttpConfigError`), so the filter does not replay it, remembers the
   token as rejected and leaves the refresh to the next request.
   *Rejected: throwing on a non-replayable 401.* The response is information the caller can use, and
   an error would hide its status, headers and body.
   *Rejected: a result union from the filter.* A filter returns a `Response`; a second return shape
   would change `Filter` for every caller.

10. **`authorize` chooses the requests that get a token, and the default is the `baseUrl` origin.**
    It takes the `HttpRequest`. Through `HttpClientBuilder.oauth2(options)` it is optional: without
    it, a request gets a token only when its `url.origin` equals the origin of the client's
    `baseUrl`. The builder binds that origin in `build()`, so `.baseUrl()` may be called before or
    after `.oauth2()`, and `build()` throws `HttpConfigError` when `authorize` is omitted and no
    `baseUrl` is set. `oauth2Filter(options)` on its own knows no `baseUrl`, so `authorize` is
    required there (`OAuth2FilterOptions`; the builder takes `OAuth2Options`, where it is optional)
    and a missing one throws `HttpConfigError`. `authorize: () => true` is the explicit opt-in to a
    token on every request. A request that already carries `Authorization` passes through untouched,
    so the caller's header wins. The filter sets `Authorization` on the context it receives. The retry filter
    sits inside `AUTH` and forks each attempt, so a replay or a retry carries the header; a custom
    filter ordered before `AUTH` that calls `next(ctx)` again sees the header as caller-set and passes
    it through.
    *Rejected: authorizing every request by default.* A client given an absolute URL bypasses
    `baseUrl`, so a default that accepts every request sends the bearer token to any host the URL
    names; leaking a token must take a decision the caller writes down.
    *Rejected: binding the origin when `.oauth2()` is called.* It would make the call order of
    `.baseUrl()` and `.oauth2()` matter, and silently leave a client without a token, or with the
    wrong origin, when `.baseUrl()` comes second.

11. **The token request goes through the context's raw `fetch`.** No filter, the OAuth2 filter
    included, sees it, so it cannot recurse or be retried by a policy meant for API calls.

12. **`HttpClientBuilder.oauth2(options)` adds an `oauth2Filter` under the name `"oauth2"`.** Bad
    options throw `HttpConfigError` before the builder changes. With `authorize` given, it is
    `filter(oauth2Filter(options))`. Without it, the builder holds the validated options in the
    filter's place and `build()` builds the filter bound to the `baseUrl` origin, one instance per
    origin per `.oauth2()` call, so repeated builds with the same origin share it. A built client
    holds the bound instance, and `extend()` shares it, so clients extended from one share a token
    cache and one in-flight refresh; that is intended. The extension keeps the origin the client was
    built with even when it sets another `baseUrl`, so a token never follows a changed `baseUrl`
    without a new `.oauth2()` call.

## Consequences

- `HttpClient.builder().baseUrl(url).oauth2({ source: clientCredentials({ ... }) })` gives a client
  that acquires, caches and refreshes a bearer token, sends it only to the `baseUrl` origin, and
  recovers from one rejected token without the caller.
- A replayed call costs the breaker, limiter and bulkhead a second pass and starts a new retry budget.
- A caller with a rotating or shared token supplies an `OAuth2TokenStore`; one with another grant
  supplies an `OAuth2TokenSource`.
- Release notes are written at release time, not with this decision.
