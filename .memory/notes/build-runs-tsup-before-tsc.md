---
name: build-runs-tsup-before-tsc
kind: invariant
description: Every package's build must be `tsup && tsc`; reversing it lets tsup's clean wipe the tsc-emitted .d.ts files.
anchors:
  - path: source/*/packages/*/package.json
    matches:
      - path: source/core/packages/common/package.json
        blob: 9f41e3c73ba2
      - path: source/core/packages/observability/package.json
        blob: f27cf10262ed
      - path: source/core/packages/redaction/package.json
        blob: 287f01ca8eac
      - path: source/ts/packages/ts/package.json
        blob: 3d18717ee2dd
  - path: source/*/packages/*/tsup.config.ts
    matches:
      - path: source/core/packages/common/tsup.config.ts
        blob: 3f3d16e7cd8f
      - path: source/core/packages/observability/tsup.config.ts
        blob: d2c1588f4b2f
      - path: source/core/packages/redaction/tsup.config.ts
        blob: a31c1c463675
      - path: source/ts/packages/ts/tsup.config.ts
        blob: a31c1c463675
  - path: source/core/tsconfig.base.json
    blob: 09df051657eb
confidence: verified
---

Every package's `build` script is `tsup && tsc -p tsconfig.build.json`. Examples:
`source/core/packages/common/package.json:45` and `source/ts/packages/ts/package.json:38`.

The two tools write to the same `dist/`:

- tsup produces JS only (`dts: false`), and `clean: true` empties `dist/` first
  (`source/core/packages/common/tsup.config.ts:9-11`, and the same in every package's
  `tsup.config.ts:11`).
- tsc produces declarations only (`emitDeclarationOnly: true`, `outDir: dist`,
  `source/core/packages/common/tsconfig.build.json:4-6`) and deletes nothing.

The comments explain why tsc is there at all: `tsup --dts` throws on the pinned typescript
(`source/core/tsconfig.base.json:1-3`). They do not say that the order matters. With
`tsc && tsup`, tsup's clean deletes the `.d.ts` files, `dist/` ends up with JS and no types, and
dependents fail type-check. Their `exports` `types` conditions point only into `dist/` (see
[[workspace-deps-resolve-through-dist-only]]). A new package, or a cleanup of the script, has to
keep `tsup` first.
