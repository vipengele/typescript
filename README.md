# vipengele/typescript

The TypeScript framework of the vipengele platform: runtime-agnostic libraries for the browser and
Node. The repo holds **projects**, each a self-contained pnpm workspace under `source/<project>/`.
Every project is released together, at one version, by one tag `vX.Y.Z`
([ADR-0001](docs/adr/0001-projects-release-together-at-one-version.md)).

| Project | Packages |
|---------|----------|
| [`source/core`](source/core) | [`@vipengele/ts-core-common`](source/core/packages/common), [`@vipengele/ts-core-redaction`](source/core/packages/redaction), [`@vipengele/ts-core-observability`](source/core/packages/observability) |

Packages publish to the public npm registry under the `@vipengele` scope, ESM only, and run in the
browser and in Node 24+.

## Develop

Work happens inside a project's directory:

```sh
cd source/core
pnpm install
pnpm exec playwright install chromium   # once: the browser half of every suite
pnpm build
pnpm test                               # every suite, under Node and in Chromium
pnpm lint
```
