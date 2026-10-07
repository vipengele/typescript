---
about: a Headers value outside Latin-1 is rejected, so redactHeaders stores "[REDACTED]" for it; maskKeepLast therefore defaults to "*" and not the issue's bullet
saw:
  - source/core/packages/redaction/src/mask.ts
  - source/core/packages/redaction/src/headers.ts
  - docs/adr/0015-masking-and-pseudonymization-are-synchronous-replacements.md
---
- `Headers.append` throws for a value containing a code point above U+00FF, such as U+2022. `headers.ts` (`HEADERS_FALLBACK`, the `try`/`catch` around `out.append`) stores `"[REDACTED]"` for that header rather than throwing, so a bullet mask char silently loses the partial mask for every header written into a `Headers`.
- `maskKeepLast` defaults `maskChar` to `*`; a caller can pass another, and `MaskOptions.maskChar` documents the `Headers` fallback. ADR-0015 lists `•` as a rejected default for this reason.
