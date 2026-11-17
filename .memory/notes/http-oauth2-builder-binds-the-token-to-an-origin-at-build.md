---
name: http-oauth2-builder-binds-the-token-to-an-origin-at-build
kind: gotcha
description: builder.oauth2() without authorize binds the token to the baseUrl origin in build(), and extend() keeps that bound filter, so an extension with another baseUrl still authorizes only the original origin.
anchors:
  - path: source/core/packages/http/src/client.ts
    blob: fb1b2adb26ff
confidence: verified
---

In `source/core/packages/http/src/client.ts`, `HttpClientBuilder.oauth2(options)` without an
`authorize` option adds a `DeferredOAuth2` entry (`:27-48`, `:166`). `build()` turns it into a
real filter with `bind(baseUrl)` (`:188`), whose `authorize` is
`request.url.origin === origin` (`:44`). One filter is cached per origin (`#byOrigin`, `:30,42-45`),
so rebuilding the same builder reuses one token cache and one in-flight refresh.

Surprises:

- A built client holds only bound filters, so `extend()` (`:268`) copies the same instance. An
  extension given a different baseUrl still sends the token only to the original origin. Calling
  `.oauth2()` again on the extension is how to bind a new one.
- A baseUrl with an opaque origin (`custom://host`) has origin `"null"`, which equals every other
  opaque origin; nothing guards against that.
