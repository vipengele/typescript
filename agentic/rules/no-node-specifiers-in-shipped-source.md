---
description: "Shipped src never imports a node: specifier except via import type; reach built-ins through process.getBuiltinModule."
---

# Never import a `node:` specifier in shipped `src/` outside `import type`

A `node:` specifier survives into `dist/` unless the import naming it is erased at compile time, and a
browser-targeting bundler then has a Node built-in to resolve, stub or externalize. Only `import type`
is erased whole; `import { type X }` keeps a side-effect import under `verbatimModuleSyntax`.

## Applies to

Every non-test `src/**/*.ts` under `source/core` and `source/ts`, enforced by
`biome/no-node-imports.grit` and `biome/check-node-import-ban.mjs`. Test files are exempt.

## Example

```ts
// ✗ import { readFileSync } from "node:fs";
// ✓ import type { Buffer } from "node:buffer";
// ✓ const fs = process.getBuiltinModule?.("node:fs");
```
