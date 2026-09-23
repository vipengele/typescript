---
about: source/ts/packages/ts/package.json
saw: 20260923
---

`@vipengele/ts` (`source/ts/packages/ts/`) deliberately has zero `@vipengele/*` dependencies.
This is a hard technical constraint, not a scope decision to revisit casually: as of this
writing nothing has ever been published to the npm registry under `@vipengele/*` (`git tag` is
empty, every package is at `0.0.0`), so a real published-range dependency on
`@vipengele/ts-core-common` would fail `pnpm install --frozen-lockfile` in this package's own CI
regardless of pin strategy. See ADR-0003. The dependency (and the `Numeric` re-export) is a
follow-up, gated on `@vipengele/ts-core-common`'s first real registry publish — don't add it
speculatively before that.
