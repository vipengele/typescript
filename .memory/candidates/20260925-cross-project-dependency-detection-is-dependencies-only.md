---
about: every cross-project-dependency consumer (build-cross-project-deps, verify-cross-project-deps, changed-projects, the release skill) scans only a package's `dependencies` field, never `peerDependencies`/`optionalDependencies`, to find a cross-project edge
saw:
  - .github/actions/build-cross-project-deps/build.sh
  - .github/actions/verify-cross-project-deps/verify.sh
  - .github/actions/changed-projects/action.yml
  - agentic/skills/release/SKILL.md
  - docs/adr/0009-a-cross-project-dependency-is-an-exact-pin-linked-locally.md
---

`build-cross-project-deps/build.sh` and `changed-projects/action.yml` originally also matched
`peerDependencies` and `optionalDependencies` when discovering a cross-project edge, while
`verify-cross-project-deps/verify.sh` (and the release skill's pin-rewrite step) matched only
`dependencies`. A `panel-code-review` pass on issue #71 caught the mismatch: a peer or optional
dependency on a sibling package would get built and select its dependent in CI, but its pin and
`link:` override were never checked, so a broken one only surfaced at install or publish.

ADR-0009's "Considered options" section explicitly rejects "Peer dependencies only" as a design —
its own worked example only ever shows a `dependencies` entry. That settles the scope: a cross-project
dependency is a `dependencies` entry, full stop. `build.sh` and `changed-projects/action.yml` were
narrowed to `(.dependencies // {}) | keys` to match; all four consumers now agree.

A `peerDependencies`/`optionalDependencies` entry naming a sibling project's package is therefore
outside every one of these checks — it is not treated as a cross-project dependency at all, and
nothing in CI or release validates it has a matching `link:` override.
