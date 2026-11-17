---
about: "http package conventions a new filter, builder method or error must follow (clock injection, errors, no logging, no single-flight helper, doc surfaces)"
saw:
  - source/core/packages/http/src/client.ts
  - source/core/packages/http/src/errors/http-errors.ts
  - source/core/packages/http/src/resilience/predicates.ts
  - source/core/packages/http/src/index.ts
  - source/core/packages/http/AGENTS.md
  - source/core/packages/http/README.md
---
- Clock: options take `clock?: Clock` (type from `@vipengele/ts-core-common` root, index.ts:11-12), default
  `systemClock` (predicates.ts:1,112); tests use `createManualTime` from `@vipengele/ts-core-common/testing`
  (retry-filter.test.ts:1,43). HttpContext has no clock.
- Builder: `filter()` replaces same-name in place (client.ts:~65-75); `resilience()` removes known names then
  adds, building before mutating (client.ts:~101-105); eager validation throws HttpConfigError
  (baseUrl via resolveUrl, removeFilter client.ts:~89, filter() validates name/order filter.ts:42-50).
- Errors: abstract `HttpError extends VipengeleError`; `code = "http.<kind>"` const exported
  (http-errors.ts:8,11); guard is `instanceof Error && code === CODE`; `isHttpError` matches the `http.` prefix
  so a new code needs no guard change; url redacted with redactUrl, `response` defined non-enumerable via
  defineProperty (http-errors.ts:49-54). `OAuth2TokenError` takes a free-text `reason` that goes into the
  message, so callers pass fixed phrases only, never response content or a token (http-errors.ts, the
  OAuth2TokenErrorDetails doc comment).
- No logging and no console anywhere in http src (grep). The only form body and base64 encoding is
  `src/auth/client-credentials.ts` (URLSearchParams, TextEncoder + btoa). No single-flight helper exists in
  common/resilience; `src/auth/oauth2-filter.ts` keeps its own `inFlight` promise, cleared in `finally`.
- Exports: new src files go through src/index.ts (root barrel) and src/resilience/index.ts; no tsup/exports edit
  needed unless a NEW sub-path is added (package-exports.test.ts only compares exports keys with tsup entries).
- Docs surfaces: AGENTS.md package layout, README.md, CONTEXT.md glossary (Filter/Http Context entries ~316-338),
  docs/release-notes/vX.Y.Z.md (written at release time), and a new ADR (two files share number 0029, so
  number from the highest file in docs/adr/, e.g. 0031-oauth2-filter-single-flight-refresh-and-replay-once.md).
- Module-level state exception: dispatch.ts:233 keeps a module-level WeakMap with a comment justifying it; the
  globalThis rule applies only to realm-wide shared state, so a per-filter token cache is closure state.
