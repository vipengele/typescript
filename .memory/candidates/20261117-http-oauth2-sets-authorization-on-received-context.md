---
about: "oauth2Filter writes Authorization into the context it receives, so an outer filter that calls next(ctx) again sees it as a caller-set header"
saw:
  - source/core/packages/http/src/auth/oauth2-filter.ts
  - source/core/packages/http/src/filter.ts
  - source/core/packages/http/src/resilience/retry-filter.ts
---
- The filter passes a request through untouched when it already carries `Authorization` (the caller's
  header wins) and otherwise does `setBearer(ctx.request.headers, token)` on the received context
  (oauth2-filter.ts:~253), not on a fork. Only the 401 replay uses `ctx.fork()`.
- Order.AUTH is 200 and RETRY is 1000 (filter.ts:8-17), so retry runs inside auth and builds a fresh
  attempt context per attempt (retry-filter.ts:46); each attempt carries the header, which is correct.
- A custom filter ordered below AUTH (e.g. OBSERVABILITY, 100) that calls `next(ctx)` a second time with
  the same context hands the oauth2 filter a request that already has `Authorization`. The filter treats it
  as caller-set and passes it through with the old token: no staleness check, no 401 replay. ADR-0031
  records this.
- The access token is checked against the RFC 6750 b64token charset before `headers.set`
  (oauth2-filter.ts:84-90), because `Headers.set` echoes an invalid value in its TypeError.
