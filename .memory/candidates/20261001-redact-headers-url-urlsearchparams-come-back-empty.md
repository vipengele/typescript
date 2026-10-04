---
about: redact() returns {} for Headers, URL and URLSearchParams (no own enumerable keys, not opaque); redaction has no URL/header helpers and observability does not call redact or define a request shape yet
saw:
  - source/core/packages/redaction/src/redact.ts
  - source/core/packages/redaction/src/secret-keys.ts
  - source/core/packages/redaction/src/index.ts
  - source/core/packages/redaction/package.json
  - docs/adr/0011-redaction-presets-and-exceptions.md
  - source/core/packages/observability/src/errors/event.ts
---

- `redact.ts:145-155` isOpaque excludes URL; `Headers` and `URLSearchParams` are not listed either, so
  `walkContainer` (`redact.ts:176-183`) falls to `walkFields` and returns `{}` (own keys are `[]`;
  checked in node: `Object.keys` of Headers, URLSearchParams and URL are all `[]`). Header tuples
  `[name, value][]` are walked as arrays of arrays, so the header NAME is a value, never a key:
  `secretKeys` never matches `["Authorization", "Bearer x"]`.
- `secretKeys` (`secret-keys.ts:3-17`) is whole-word `{segments}`: covers authorization, cookie (so
  Set-Cookie), api key (so x-api-key), password, token, secret, session, bearer, credential. Not
  `apikey`, `auth`, `key` (ADR-0011).
- Exports are root-only (`index.ts`, `package.json` exports `.` and `./package.json`); ADR-0011
  rejected a sub-path for the two-name surface, with no stated threshold for new ones. Observability
  `src` has zero references to redact; `ErrorEvent` has no request field (`mechanism.source`
  includes "network"; Breadcrumb has `category 'http'`, `data?: Attributes`, ADR-0007); CONTEXT.md
  avoids the term "request context".
- Node check (v22 here): Headers iteration lower-cases names and yields one `set-cookie` entry per
  cookie; `get("set-cookie")` joins with ", ". URLSearchParams re-serialization turns `%20` into `+`
  and percent-encodes `~` and `!`; `url.href` after `searchParams.set` rewrites the whole query so.
- Not verified: Chromium behaviour, and Node 24 specifically.
