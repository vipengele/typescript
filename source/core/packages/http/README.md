# @vipengele/ts-core-http

An HTTP client for the browser and Node, built on `fetch`: an immutable request builder, an ordered
chain of filters for cross-cutting behaviour, and typed errors.

| Entry point | What it holds |
|-------------|---------------|
| `@vipengele/ts-core-http` | `HttpClient`, `filter`, `Order`, `isOneShotBody` and the types, plus the errors |
| `@vipengele/ts-core-http/errors` | `HttpStatusError`, `HttpConfigError` and their guards |

```sh
pnpm add @vipengele/ts-core-http
```

Runs in the browser and in Node 24+. ESM only, side-effect free. It sends through `fetch` and has
no HTTP dependency; the decisions behind it are in
[ADR-0029](../../../../docs/adr/0029-http-client-is-a-fetch-filter-chain.md).

## Quick example

```ts
import { HttpClient, filter, Order } from "@vipengele/ts-core-http";

type PurchaseOrder = { id: string; sku: string };

declare function token(): string;

const auth = filter({
  name: "auth",
  order: Order.AUTH,
  handle(ctx, next) {
    ctx.request.headers.set("authorization", `Bearer ${token()}`);
    return next();
  },
});

const client = HttpClient.builder().baseUrl("https://api.example.com/v1").filter(auth).build();

const order = await client.get("/orders/42").json<PurchaseOrder>();
const created = await client.post("/orders").json({ sku: "A-1" }).json<PurchaseOrder>();
```

A request builder is immutable: `header`, `query`, `json(body)`, `body`, `signal` and `attribute`
each return a new builder, and nothing is sent until a terminal is called. Each terminal call sends
the request again. A header set on the request wins over a client header of the same name.

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
`build()` throws an `HttpConfigError` naming both otherwise. `ctx.fork()` makes the context of another
attempt, with `attempt` one higher.

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
a `TypeError` that quotes it, password included. Send credentials in a header, from an auth filter.

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
| `HttpError` (the base) | any `http.*` | `isHttpError` |

Guards match on `code`, never on class identity, so they hold across two resolved copies of the package.
