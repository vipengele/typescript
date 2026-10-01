---
about: the `@vipengele/ts` umbrella re-exports redaction names one by one, so a new redaction export does not reach consumers of the umbrella until it is added to the umbrella's index.ts
saw:
  - source/ts/packages/ts/src/index.ts
  - source/ts/packages/ts/src/index.test.ts
  - agentic/vipengele-typescript.md
---

`source/ts/packages/ts/src/index.ts` lists each redaction export by name (`composePolicies`,
`redact`, `secretKeys`, plus the types), so adding an export to `@vipengele/ts-core-redaction`
leaves `@vipengele/ts` unchanged until the name is added there, with a test in `index.test.ts` and
an update to the re-export sentence in `agentic/vipengele-typescript.md` (then `agtk render`).
The umbrella pins redaction exactly with a `link:` override (ADR-0009), and resolves it through the
linked package's `dist/`, so the umbrella's tests only see a new export after redaction is rebuilt.
