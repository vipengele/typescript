---
about: redact() has cycle detection but no depth/breadth/string limits, though v0.0.2 notes and package.json claim them; toJsonSafe's bounds semantics differ from redact's walk and cannot be aligned for free
saw:
  - source/core/packages/redaction/src/redact.ts
  - source/core/packages/redaction/README.md
  - source/core/packages/redaction/package.json
  - docs/release-notes/v0.0.2.md
  - source/core/packages/common/src/serialization/engine.ts
  - docs/adr/0007-the-log-record-and-error-event-data-model.md
---

Issue #20 context. Verified by reading, `grep -rn 'depth|Circular' redaction/src`:

- `redact()` (redact.ts:36) has only a cycle guard (ancestor-path WeakSet, `[Circular]`, redact.ts:12-49).
  No depth/array/string bound; `RedactOptions` has only `replacement` (redact.ts:5-8). Deep input recurses
  walk -> walkContainer -> walkFields -> setField -> redactField -> walk with no catch, so it ends in a
  RangeError whose threshold depends on the runtime (not run; reasoned from code). No test covers depth.
- Docs are inconsistent: README.md:3-5 says depth/size limits are "outside this package's scope", but
  docs/release-notes/v0.0.2.md:25-27 says redact "honours depth and size limits through RedactOptions" and
  redaction/package.json:4 description says "depth and size limits". Release notes are wrong today.
- toJsonSafe (common/src/serialization/engine.ts): maxDepth 6 (:12, root = depth 1, container deeper ->
  `"[Truncated]"` :268-270), maxBreadth 100 (:13; objects/arrays/Maps/Sets cut + `"[Truncated: N more]"`
  marker :62-64, object marker key "…" :73-77), maxStringLength 8192 (:14; suffix `"…[truncated]"` :20,58),
  cycles `"[Circular]"` (:16,237). Also `"[Unreadable]"` for throwing getters. Same ancestor-path WeakSet design.
  Marker `[Circular]` is already identical in redact.ts:13.
- Key semantic difference: toJsonSafe honours toJSON, flattens Map/Set/Date/Error; redact preserves
  Map/Set/Date identity and drops toJSON (README.md:87-93). So limits cannot be delegated to toJsonSafe
  without changing redact's output types.
- Ordering: ADR-0007:106-117 says normalizer (bounds) runs first, "Redaction runs at the same point" after.
  Observability does not import redaction yet (src stubs; package.json:57 declares workspace:* dep only), so
  in the logger path redact would see an already-bounded tree; limits matter for standalone use.
- redaction package.json has no `dependencies`; common does not depend on redaction. Depending on common
  would be an intra-project `workspace:*` (core project), legal but dist-only resolution applies
  (see note workspace-deps-resolve-through-dist-only; .lydite/components.yml:12-14 core-redaction has no
  setup/depends_on, would need one).
- Coverage gate: source/core/vitest.shared.ts:18-22 thresholds 100% on statements/branches/functions/lines,
  union of node + chromium runs. Any new branch needs a test.
