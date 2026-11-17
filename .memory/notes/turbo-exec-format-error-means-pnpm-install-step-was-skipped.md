---
name: turbo-exec-format-error-means-pnpm-install-step-was-skipped
kind: gotcha
description: turbo failing every task with 'Exec format error (os error 8)' means pnpm's self-managed copy never ran its install.js; it is an environment fault, not a code one.
anchors:
  - path: source/core/package.json
    blob: c33fd091fba9
confidence: suspect
---

Checked: `source/core/package.json:4` pins `packageManager: pnpm@12.4.1`.

Reported by the explorer, not reproducible from the repo: pnpm self-manages that version under
`~/.local/share/pnpm/.tools/pnpm/12.4.1/`, and its `node_modules/pnpm/pnpm` is a shebang-less
placeholder that `install.js` replaces with the native binary. When that step was skipped, the
`pnpm` shim on PATH still works (it is a Node script), but turbo spawns the tool path directly
and every task fails with `Exec format error (os error 8)`.

Running `node install.js` in that `node_modules/pnpm` directory fixed it. Do not go looking for
a cause in `turbo.json` or the packages.
