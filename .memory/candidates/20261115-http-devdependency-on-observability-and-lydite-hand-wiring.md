---
about: "a structural HttpLogger is not satisfied by observability Logger.warn/error (second param is error), and http->observability devDependency is cycle-free only while observability never depends on http"
saw:
  - source/core/packages/observability/src/logger/logger.ts
  - source/core/packages/observability/package.json
  - source/core/packages/http/package.json
  - source/core/turbo.json
  - .lydite/components.yml
  - docs/adr/0029-http-client-is-a-fetch-filter-chain.md
---
Verified by reading.

- Logger signature (logger.ts:79-84): `trace/debug/info(message, attributes?)` but `warn/error/fatal(message, error?: unknown, attributes?)`. A structural `HttpLogger { warn/error(message: string, attributes?: Record<string, unknown>): void }` type-checks against Logger only by accident: `Record<string, unknown>` is assignable to `unknown` (the error slot), so it compiles, yet at runtime an attributes object passed as the 2nd arg to warn/error is treated as the ERROR and serialized via serializeError, and attributes are lost. debug/info match. A B4 logging filter must either call `warn(msg, undefined, attrs)`-style via an adapter or define HttpLogger with the Logger's arity; a test with a real observability Logger (devDependency) is the only way to catch this.
- ADR-0029 decision 4 (http ADR): http does not depend on observability; observability is a caller-written filter in the OBSERVABILITY band; a dependency "would make the two circular" because the error reporter's HTTP transport (ADR-0010) is the reverse edge. Today observability's `createHttpTransport` uses raw fetch and imports nothing from http (grep "ts-core-http" over source/ -> only http's own files); observability deps are common, redaction, resilience (observability/package.json:55-59). So a http devDependency on observability is acyclic today. It stays acyclic only while observability never depends on http; turbo's `^build` graph includes devDependencies, so a later observability->http edge would be a turbo cycle.
- Intra-project deps are `workspace:*` (http/package.json:56-59); the cross-project pin/link rule does not apply (same project, source/core).
- lydite is hand-wired: the core-http component lists depends_on [core-common, core-redaction] with two setup builds (.lydite/components.yml:~29-37). B2 (resilience dep) and a logger devDependency must add core-resilience and core-observability (and observability's own deps: common, redaction, resilience) to depends_on and add `pnpm --filter ... run build` setup steps, else lydite tests against missing dist/ (see note workspace-deps-resolve-through-dist-only). Also `release.yml` publish order globbing and the tsup/package-exports test apply to any new http sub-path.
