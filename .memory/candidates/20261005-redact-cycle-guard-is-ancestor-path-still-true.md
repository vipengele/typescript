---
about: claim re-checked while reading redact.ts for issue #23; holds, line pointers moved
saw:
  - source/core/packages/redaction/src/redact.ts
targets: redact-cycle-guard-is-ancestor-path
verdict: still-true
---
Re-read redact.ts in full. Claim holds. Pointer correction: walk() now redact.ts:111-123 (ancestors add/delete in try/finally at :117-122).
