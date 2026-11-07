---
about: "turbo failing every task with Exec format error means pnpm's self-managed copy never ran its install.js"
saw:
  - source/core/package.json
---

- `source/core/package.json` pins `packageManager: pnpm@12.4.1`. pnpm self-manages that version under `~/.local/share/pnpm/.tools/pnpm/12.4.1/`, and its `node_modules/pnpm/pnpm` is a shebang-less placeholder that `install.js` replaces with the native binary.
- When that install step was skipped, the `pnpm` shim on PATH still works (it is a Node script), but turbo spawns the tool path directly and every task fails with `Exec format error (os error 8)`. Running `node install.js` in that `node_modules/pnpm` directory fixes it; it is an environment fault, not a code one.
