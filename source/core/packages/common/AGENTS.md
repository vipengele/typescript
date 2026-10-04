# @vipengele/ts-core-common

Shared types and primitives, exposed as tree-shakeable sub-paths. Run commands from `source/core`
(`pnpm build`, `pnpm type-check`, `pnpm test`, `pnpm lint`, `pnpm format:check`).

## Scope (`src/scope`, `./scope`)

- `Scope` is the ambient context tree: `current`, `propagate`, `inherit`, `isolated`, `resource`,
  `useCarrier`. Its root holds the four reserved Resource keys (`service.name`,
  `service.version`, `deployment.environment.name`, `process.runtime.name`).
- `Scope.resource()` returns the `Resource` (exported type) read from the realm's one root,
  whatever scope is current. The logger passes it to every Sink per record; it is a function, not a
  captured value, because an application may supply the Resource after a Logger was created.
- `@isolatedScope`/`@scoped` support both decorator dialects (`agentic/rules/method-decorator-supports-both-dialects.md` at the repo root).
