# One build per package; runtime-specific code is chosen by lazy feature detection

Every entry point of every `@vipengele/*` package resolves to one file in every runtime: an
`exports` target carries `types` and `default`, never `node` or `browser` conditions. Code that
differs between the browser and Node lives side by side in that file, and the branch taken is
decided the first time a capability is needed — console styling (`%c`), ANSI colour, async
context, `sendBeacon`, process exit hooks — each detected on its own and cached, never inferred
from a single `typeof window` or `typeof process` check made at load time.

A Node built-in is reached through `process.getBuiltinModule('node:…')`, a synchronous call
available in Node 24, Bun and Deno, guarded by checking that the function exists rather than that
`process` does (bundlers polyfill `process`). Only `import type` may name a `node:` specifier, so no
`node:` import survives into `dist/` and no bundler has anything to resolve, stub or externalize.
Capability detection accepts an injected capability source, so a unit test forces the branches of
runtimes the suite does not run in (a web worker, jsdom, a runtime without `getBuiltinModule`); the
Node and Chromium runs cover each runtime's real branch.

## Why not conditional `exports`

Conditions move the runtime choice to the resolver, which is exactly where it goes wrong without a
sign: a bundler or test runner configured with the wrong conditions silently resolves the other
runtime's file. They also make two files for one version, and both can be loaded into one process
— a server-rendering bundle that holds the browser build next to Node's own copy — which is one more
way for state the package shares across copies (the logger's level table, the async context store)
to be read by code that disagrees about its shape.

A single `typeof window` check made at load time is the other failure mode: web workers support
`%c` without having a `window`, and jsdom defines `window` inside Node.

## Consumers import through the umbrella

The intended import is `@vipengele/ts/logger`, not `@vipengele/ts-core-observability/logger`.
`@vipengele/ts` mirrors every entry point it re-exports one-to-one, each as a single-target export
that is only `export * from '<package>/<entry>'`. Its build keeps every `@vipengele/*` import
external: an umbrella that inlined a package's code would put a second copy of it into every app
that also has a library importing the package directly, and a second copy is a second context
store and a second class identity.

## Considered options

- **Conditional `exports` for everything runtime-specific.** The conventional answer; rejected for
  the reasons above.
- **Conditions only where an import cannot be referenced in the other runtime, detection for
  behaviour.** Sound in general, but every such import this framework needs today is a Node
  built-in, which `getBuiltinModule` reaches without an import. Conditions stay the escape hatch
  for a future dependency that exists only for one runtime and is not a built-in.
- **Detection with a static `import 'node:async_hooks'`.** Breaks browser bundlers that resolve
  every import eagerly.

## Consequences

A browser bundle carries the Node-only branches of whatever it imports, because tree shaking cannot
remove a branch chosen at runtime. The cost is kept small by making heavy runtime-specific pieces —
formatters, exporters — separate classes a consumer passes in, not code the default path
references. A bundle check asserts that no `node:` specifier reaches `dist/` and that
`@vipengele/ts` contains no inlined `@vipengele/*` code.
