---
description: Nothing that builds, tests or ships lives at the repo root; it lives in a project under source/.
---

# All code lives under `source/`

Every package, app, script, manifest, lockfile and tool config that builds, tests or ships
belongs to a project under `source/<project>/`. The repo root holds only what crosses projects:
`.github/`, `agentic/`, `.memory/`, `.lydite/`, `.serena/`, `.gt.yaml`, `.gt-repo.yaml`,
`.bulwark.yml`, `docs/`, `CONTEXT.md`, `README.md` and `LICENSE`.

A root `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `biome.json` or `src/` would make
the root a workspace of its own: CI's change detection selects projects by their `source/`
directory and would never build or test it, and the release workflow would never publish it.

## Applies to

- Any new package, app or tool: it goes in an existing project's `packages/`, or starts a new
  project under `source/<project>/` with its own workspace files (ADR-0001).
- Tooling convenience at the root (a root `package.json` to run every project, a shared
  `tsconfig`): not allowed. Shared config is repeated per project, or lives inside one.

## Example

A shared Vitest preset for every project is not a root `vitest.config.ts`; each project carries
its own `source/<project>/vitest.shared.ts`.
