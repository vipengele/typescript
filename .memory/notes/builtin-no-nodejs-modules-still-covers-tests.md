---
name: builtin-no-nodejs-modules-still-covers-tests
kind: gotcha
description: "Biome's built-in noNodejsModules is on everywhere via correctness=error, so a node: import in a test still fails lint despite the plugin exemption."
anchors:
  - path: source/core/biome.json
    blob: 69e958577677
confidence: suspect
---

`source/core/biome.json` sets `"correctness": "error"` (line 27), which enables biome's built-in
`noNodejsModules` for all linted files, including `*.test.ts`. The grit plugin exempts tests via
its `includes` (see [[node-import-ban-copies-must-be-identical]]), but the built-in rule does not,
so a future `*.node.test.ts` importing a `node:` specifier would fail lint. Only the `biome/*.mjs`
override (`biome.json` overrides) turns `noNodejsModules` and `noProcessGlobal` off.

Not verified by running lint: the explorer reported (biome 2.5.12) that `overrides[].plugins` can
only add a plugin, never disable a top-level one. The `import { type X } from "node:…"` ban is
documented in the comments of `source/core/biome/no-node-imports.grit`.
