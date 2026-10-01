---
name: node-import-ban-copies-must-be-identical
kind: gotcha
description: "The node: import ban grit plugin is copied per project and check-node-import-ban.mjs fails lint when the copies differ."
anchors:
  - path: source/core/biome/no-node-imports.grit
    blob: 33dba59341bb
  - path: source/ts/biome/no-node-imports.grit
    blob: 33dba59341bb
  - path: source/core/biome/check-node-import-ban.mjs
    blob: 971b858f903c
confidence: verified
---

Biome resolves a plugin path relative to the `biome.json` naming it (`source/core/biome.json`
`plugins`), so `source/core` and `source/ts` each carry their own `biome/no-node-imports.grit`.
`biome/check-node-import-ban.mjs` (header comment, lines 1-5) fails when the copies are not
byte-identical, and `lint` runs it (`source/core/package.json` `lint`:
`biome lint . --error-on-warnings && node biome/check-node-import-ban.mjs`). Edit both copies
together. The script lints `biome/fixtures/{must-fail,must-pass}` with `--vcs-use-ignore-file=false`;
`fixtures/.ignore` hides them from plain `biome lint .`.

Test files are exempted by the plugin's own `includes` (`["**/src/**/*.ts", "!**/*.test.ts"]`,
`source/core/biome.json` lines 16-21), not by an override. See also
[[builtin-no-nodejs-modules-still-covers-tests]].
