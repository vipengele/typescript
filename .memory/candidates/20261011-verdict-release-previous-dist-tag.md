---
about: release-previous-dist-tag-is-sticky-per-project line numbers moved by 8
saw:
  - .github/workflows/release.yml
targets: release-previous-dist-tag-is-sticky-per-project
verdict: unchecked
---
Only spot-checked: `dist_tag=latest` is now at release.yml:423 (note says 415), `dist_tag=previous` at :450 (note says 442), publish at :458 (note says 450). Logic not re-read, so the claim is unchecked beyond the line shift.
