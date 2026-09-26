---
description: A cross-project dependency needs both an exact pin in `dependencies` and a matching `link:` override in `pnpm-workspace.yaml`.
---

# A cross-project dependency needs an exact pin and a matching `link:` override

Naming a sibling project's package in a package's `dependencies` is not enough on its own: the
depending project's `pnpm-workspace.yaml` must also override that name with a `link:` to the
sibling's package directory. `verify-cross-project-deps` fails CI and the release `tag` job on
either half being missing, and `changed-projects` and `build-cross-project-deps` only see the
dependency through the pin. See ADR-0009 for the full rationale.

## Applies to

Any `package.json` under `source/*/packages/*/` whose `dependencies` names a package owned by a
different `source/<project>`, and that project's `pnpm-workspace.yaml`.

## Example

```jsonc
// source/ts/packages/ts/package.json — the exact pin, what a consumer installs
"dependencies": { "@vipengele/ts-core-common": "0.0.2" }
```

```yaml
# source/ts/pnpm-workspace.yaml — the link override, never published
overrides:
  "@vipengele/ts-core-common": "link:../core/packages/common"
```

A `workspace:*` link, or a pin with no matching override, is not a cross-project dependency — it
is either an intra-project link or a missing half `verify-cross-project-deps` will reject.
