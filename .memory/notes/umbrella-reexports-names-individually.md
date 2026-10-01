---
name: umbrella-reexports-names-individually
kind: gotcha
description: The @vipengele/ts umbrella re-exports names one by one, so a new export in a core package doesn't reach umbrella consumers until it is added to the umbrella index.
anchors:
  - path: source/ts/packages/ts/src/index.ts
    blob: 22887f825242
  - path: source/ts/packages/ts/src/index.test.ts
    blob: 1c0a4b114760
  - path: agentic/vipengele-typescript.md
    blob: 1cbf11828983
confidence: verified
---

`source/ts/packages/ts/src/index.ts` lists each redaction export by name (`composePolicies`,
`redact`, `secretKeys`, plus types), so a new export in `@vipengele/ts-core-redaction` stays
invisible through `@vipengele/ts` until added there, with a test in `index.test.ts` and an update to
the re-export sentence in `agentic/vipengele-typescript.md` (then `agtk render`). The umbrella pins
redaction with a `link:` override (ADR-0009) and resolves it through `dist/`, so its tests see a new
export only after redaction is rebuilt ([[workspace-deps-resolve-through-dist-only]]).
