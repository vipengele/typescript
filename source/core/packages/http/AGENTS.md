# @vipengele/ts-core-http

HTTP client over `fetch`. Entry points: `.` (everything, errors included) and `./errors`. Run commands
from `source/core` (`pnpm build`, `pnpm type-check`, `pnpm test`, `pnpm lint`, `pnpm format:check`).
The decisions are in ADR-0029.

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
- `context.ts` holds `HttpContext`. `fork()` copies the URL and headers and shares the body, signal
  and attributes. `replayable` is read live from `request.body`. `markSent(body)`/`wasSent(body)`
  read the realm-wide record of dispatched one-shot bodies: one `WeakSet` on `globalThis` under
  `Symbol.for("vipengele:http:sent-one-shot-bodies")`, created on first access and shared by every
  resolved copy of the package.
- `dispatch.ts` calls `ctx.fetch(url.href, init)` and guards one-shot bodies (an async iterable goes
  through `toReadableStream` in `body.ts`, `duplex: "half"`, and any second dispatch of the same
  object — from a fork, another terminal call, a derived builder or another client — rejects with
  `HttpConfigError` before `fetch` is called). `resolveFetch` wraps the injected or global `fetch`
  so it is called as a plain function and reads `globalThis.fetch` at each call.
- `url.ts` holds `resolveUrl`, the `baseUrl` join. A resolved URL with a username or password, from
  the input or the base, throws `HttpConfigError` with the URL passed through `redactUrl`.
  `http-response.ts` holds `HttpResponse` and the empty-body rule (204, 205, `HEAD`, zero-length
  body gives `undefined`).
- Dependencies are `@vipengele/ts-core-common` and `@vipengele/ts-core-redaction` only, resolved through
  their built `dist/`. The package does not depend on `@vipengele/ts-core-observability` (ADR-0029).
