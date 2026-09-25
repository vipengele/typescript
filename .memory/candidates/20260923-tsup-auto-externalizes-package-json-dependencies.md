---
about: no package's tsup.config.ts sets `external`, yet observability's build already keeps its two @vipengele/* dependencies out of the bundle — tsup externalizes package.json dependencies by default
saw:
  - source/core/packages/observability/tsup.config.ts
  - source/core/packages/observability/package.json
  - source/core/packages/common/tsup.config.ts
  - source/ts/packages/ts/tsup.config.ts
  - docs/adr/0004-one-build-per-package-runtime-code-chosen-by-lazy-feature-detection.md
---

Checked while planning issue #71 (ADR-0004 requires the umbrella's build to keep every
`@vipengele/*` import external, "an umbrella that inlined a package's code would put a second copy
of it into every app").

`grep -rn "external" source/*/packages/*/tsup.config.ts` finds nothing — no package in the repo
configures `external` explicitly. Yet `@vipengele/ts-core-observability` already depends on
`@vipengele/ts-core-common` and `@vipengele/ts-core-redaction` as real `dependencies`
(`source/core/packages/observability/package.json:56-57`, currently `workspace:*`) and its
`tsup.config.ts` has no `external` field at all. Its build already does not inline either
package (consistent with `workspace-deps-resolve-through-dist-only`: the emitted `dist/` imports
them by specifier, resolved through `exports`, not bundled).

This is tsup's own default: it reads a package's `dependencies` and `peerDependencies` from its
`package.json` and marks those specifiers external automatically, without a `noExternal`
override. So `@vipengele/ts` needs no explicit `external: [...]` in its `tsup.config.ts` once
`@vipengele/ts-core-common` is added to its `package.json` `dependencies` — the existing
`tsup.config.ts` shape (`source/ts/packages/ts/tsup.config.ts`, no `external` key) already matches
the pattern that works for observability today. Worth confirming after wiring it up (a bundle
check per ADR-0004 asserts `@vipengele/ts` contains no inlined `@vipengele/*` code), but there is
no reason from precedent to expect `external` needs to be added by hand.
