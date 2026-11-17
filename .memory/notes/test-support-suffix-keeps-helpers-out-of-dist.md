---
name: test-support-suffix-keeps-helpers-out-of-dist
kind: gotcha
description: A test-only helper under src/ must be named *.test-support.ts and its package's tsconfig.build.json must exclude that glob, or tsc ships its .d.ts and coverage counts it; only observability excludes it today.
anchors:
  - path: source/core/vitest.shared.ts
    blob: bbc7e8c26316
  - path: source/core/packages/*/tsconfig.build.json
    matches:
      - path: source/core/packages/common/tsconfig.build.json
        blob: 618f17b5b13d
      - path: source/core/packages/http/tsconfig.build.json
        blob: 618f17b5b13d
      - path: source/core/packages/observability/tsconfig.build.json
        blob: 8cb378160075
      - path: source/core/packages/redaction/tsconfig.build.json
        blob: 618f17b5b13d
      - path: source/core/packages/resilience/tsconfig.build.json
        blob: 618f17b5b13d
confidence: verified
---

Declarations come from `tsc -p tsconfig.build.json`, which emits a `.d.ts` for every file under
`src` it does not exclude; tsup bundles only what entry points reach, so an unreachable helper is
absent from the JS but still gets a declaration in `dist/`.

`source/core/vitest.shared.ts:17` excludes `src/**/*.test.ts` and `src/**/*.test-support.ts` from
coverage, and the test `include` (`:30,37`) matches only `*.test.ts`, so a `*.test-support.ts`
file is never run as a suite and never counted against the 100% gate.

The build side is per package: only
`source/core/packages/observability/tsconfig.build.json:12` carries the second glob. common,
redaction, resilience and http exclude `src/**/*.test.ts` alone (`tsconfig.build.json:12` in
each), so the first test-support file added to one of them ships its declarations until that
line is extended.
