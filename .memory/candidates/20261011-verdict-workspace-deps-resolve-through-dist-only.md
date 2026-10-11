---
about: workspace-deps-resolve-through-dist-only still holds; line pointers shifted
saw:
  - .lydite/components.yml
  - source/core/turbo.json
  - source/core/packages/common/package.json
targets: workspace-deps-resolve-through-dist-only
verdict: still-true
---
turbo.json: `^build` on build, type-check and test (lines 3-12, note says 8-13). components.yml core-observability block is now at lines ~14-28 with depends_on + two setup builds. common exports (now includes ./testing) all point types/default into ./dist. components.yml `ts` component pointer (:29-38) not rechecked: the file now has no `ts` component entry (source/ts/packages/ts is in `excludes` instead), so that part of the note is now-false.
