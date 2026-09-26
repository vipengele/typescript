---
about: a package entry point that only re-exports (no statements of its own) reports 0/0/0/0 in vitest's v8 coverage table, and the 100%-coverage gate still passes because 0 of 0 satisfies the threshold
saw:
  - source/ts/packages/ts/src/index.ts
  - source/ts/vitest.shared.ts
---

Seen while wiring `@vipengele/ts` to `@vipengele/ts-core-common` for issue #71's second slice.
`source/ts/packages/ts/src/index.ts` became a single re-export line
(`export { Numeric } from "@vipengele/ts-core-common/types/numeric";`), and `pnpm test`'s v8
coverage report showed:

```
File      | % Stmts | % Branch | % Funcs | % Lines
index.ts  |       0 |        0 |       0 |       0
```

with the run still passing overall. A re-export has no statements, branches or functions of its
own for v8 to instrument, so the denominator is 0 — `0/0` reads as `0%` in the printed table but
is not a coverage shortfall, and the gate (100% coverage, per the root CLAUDE.md) does not fail
on it. This only holds for lydite/vitest's own coverage gate as configured today; it was not
separately checked against lydite's own coverage aggregation across components.
