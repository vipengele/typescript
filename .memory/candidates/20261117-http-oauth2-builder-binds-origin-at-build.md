---
about: "builder.oauth2() without authorize binds the token to the baseUrl origin in build(), and extend() keeps that origin"
saw:
  - source/core/packages/http/src/client.ts
  - source/core/packages/http/src/auth/oauth2-filter.ts
  - docs/adr/0031-oauth2-filter-single-flight-refresh-and-replay-once.md
---
- `oauth2Filter` itself requires `authorize` (`OAuth2FilterOptions.authorize` is not optional, and a missing
  one throws HttpConfigError in oauth2-filter.ts). It has no baseUrl to default to, and authorizing every
  request would send the token to any absolute URL.
- `HttpClientBuilder.oauth2(options)` (client.ts:~160-168) with `authorize` given builds the filter at once.
  Without one, it validates every other option eagerly (`validateOAuth2Options`) and adds a `DeferredOAuth2`
  entry (client.ts:27-48) under the name "oauth2", so filter-name replacement and `removeFilter` still apply.
- `build()` (client.ts:~188) maps each `DeferredOAuth2` to a real filter via `bind(baseUrl)`. It throws
  HttpConfigError when no baseUrl is set, and caches one filter per origin (`#byOrigin`), so rebuilding the
  same builder reuses one token cache and one in-flight refresh.
- A built client's `filters` hold only bound `Filter`s, so `extend()` (client.ts:~268) copies the same
  instance. An extension given another baseUrl still sends the token only to the ORIGINAL origin; calling
  `.oauth2()` on the extension is how to bind a new one.
- A baseUrl with an opaque origin (`custom://host`) has origin "null", which also matches any other
  opaque-origin URL; nothing guards against it.
