---
about: "workspace-deps-resolve-through-dist-only re-checked: lydite block is per-package and hand-written; resilience is the worked example"
saw:
  - .lydite/components.yml
  - source/core/packages/resilience/package.json
  - source/core/packages/resilience/vitest.config.ts
  - source/core/vitest.shared.ts
targets: workspace-deps-resolve-through-dist-only
verdict: still-true
---
Re-checked (stale only by file-hash drift). `.lydite/components.yml:16-27` observability block now lists
common, redaction AND resilience in depends_on plus three `pnpm --filter ... run build` setup steps;
`core-resilience` block (`:29-38`) has depends_on [core-common] + one setup step. Line numbers in the note
(16-27, 29-38) are now off: ts component moved, core-resilience sits after observability.
New package = new hand-written components.yml block (no graph). turbo `^build` handles the rest.
Also: no `v8 ignore`/`istanbul ignore` anywhere under source/core/packages (grep -> 0 hits); thresholds 100
on all four metrics in source/core/vitest.shared.ts, coverage excludes only *.test.ts and *.test-support.ts,
so type-only files (resilience/src/types.ts) pass because v8 sees no coverable code.
No precedent in the repo for `duplex`/ReadableStream request bodies (grep -> 0 hits in non-test src).
