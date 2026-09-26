---
about: source/core/packages/common has no @types/node dependency, so `import type` from a `node:` module doesn't type-check there; Node-shaped APIs are declared as hand-written structural interfaces instead
saw:
  - source/core/packages/common/src/context/capabilities.ts
  - source/core/packages/common/package.json
---

Hit while implementing issue #15's Node `AsyncLocalStorage` carrier. `capabilities.ts` needs the
shape of `node:async_hooks`'s `AsyncLocalStorage`, but `import type { AsyncLocalStorage } from
"node:async_hooks"` fails to type-check: `source/core/packages/common/package.json` carries no
`@types/node`, and neither does `source/core/pnpm-workspace.yaml`'s hoisted set. The package must
run unchanged in the browser (this repo's "Runtimes" convention), so it can't assume Node's ambient
types are present.

The fix is a hand-written structural interface capturing only the slice actually used —
`AsyncLocalStorageLike<T>` (`run`, `getStore`) and its constructor type — rather than pulling in
`@types/node` as a devDependency. `resolveAsyncLocalStorage` (`capabilities.ts`) returns that
structural type, cast from whatever `process.getBuiltinModule("node:async_hooks")` returns at
runtime (unchecked at the type level, since there's nothing to check against).

Anyone adding another Node built-in behind this package's capability-detection pattern hits the
same thing: don't reach for `@types/node`, declare the slice of the built-in's shape this package
actually calls, next to the capability-detection function that resolves it.
