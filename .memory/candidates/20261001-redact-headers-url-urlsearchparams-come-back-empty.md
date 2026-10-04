---
about: redact() returns {} for Headers, URL and URLSearchParams (no own enumerable keys, not opaque); redactUrl, redactQueryString and redactHeaders are the dedicated route and read strings as text; observability does not call redact or define a request shape yet
saw:
  - source/core/packages/redaction/src/redact.ts
  - source/core/packages/redaction/src/secret-keys.ts
  - source/core/packages/redaction/src/index.ts
  - source/core/packages/redaction/src/url.ts
  - source/core/packages/redaction/src/query-string.ts
  - source/core/packages/redaction/src/headers.ts
  - docs/adr/0011-redaction-presets-and-exceptions.md
  - docs/adr/0012-redact-helpers-read-strings-as-text-and-replace-whole-values.md
  - source/core/packages/observability/src/errors/event.ts
---

- `redact.ts` `isOpaque` (near line 145) excludes URL; `Headers` and `URLSearchParams` are not listed
  either, so `walkContainer` falls to `walkFields` and returns `{}` (own keys are `[]`; checked in
  node: `Object.keys` of Headers, URLSearchParams and URL are all `[]`). Header tuples
  `[name, value][]` are walked as arrays of arrays, so the header NAME is a value, never a key:
  `secretKeys` never matches `["Authorization", "Bearer x"]`. `redact`'s walk is deliberately
  unchanged; `redactHeaders` is how those values are redacted (ADR-0012).
- `redactUrl` / `redactQueryString` split the string themselves (never `new URL` or a
  `URLSearchParams` round trip, which rewrites `%20` to `+` and encodes `~` and `!`). Both share
  `redactParams` in `query-string.ts`, which takes already-resolved options. `redactUrl` always
  replaces userinfo whatever the policy; an `@` after the first `/`, `?` or `#` is ambiguous when the
  authority has a `user:pass` or `host:port` shape, so `url.ts` over-redacts up to it and still runs
  every parameter after it through the policy (`pathIsParams`, `fragmentIsParams`).
- `redactHeaders` reads a `Headers` by iteration (lower-cased names, one `set-cookie` entry per
  cookie); `get("set-cookie")` joins with ", ". A `Headers` rejects values outside Latin-1 and
  CR/LF/NUL, so a truncated value (the `…` suffix) or a non-Latin-1 replacement is stored as
  `[REDACTED]` in a `Headers` result only.
- `secretKeys` (`secret-keys.ts`) is whole-word `{segments}`: covers authorization, cookie (so
  Set-Cookie), api key (so x-api-key), password, token, secret, session, bearer, credential. Not
  `apikey`, `sig`, `signature`, `auth`, `key` (ADR-0011); `token_type` matches via its `token` word.
- Exports are root-only (`index.ts`, `package.json` exports `.` and `./package.json`); ADR-0011
  rejected a sub-path for a small surface. Observability `src` has zero references to redact;
  `ErrorEvent` has no request field (`mechanism.source` includes "network"; Breadcrumb has
  `category 'http'`, `data?: Attributes`, ADR-0007); CONTEXT.md avoids the term "request context".
- Verified in Node 22 and Chromium 153; Node 24 not run in this environment.
