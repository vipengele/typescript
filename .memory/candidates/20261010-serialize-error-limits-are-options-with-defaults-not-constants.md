---
about: serializeError's link and aggregate caps are the maxLinks and maxErrors options (defaults 5 and 100), carried in a per-call State, not module constants; the "[Truncated]" chain marker is built per call so its text names the configured maxLinks
saw:
  - source/core/packages/common/src/serialization/serialize-error.ts
  - source/core/packages/common/src/serialization/serialize-error.test.ts
  - source/core/packages/common/src/serialization/engine.ts
---
`serialize-error-link-counting` still names `MAX_LINKS` and `MAX_ERRORS` and line numbers in `serialize-error.ts`; those constants are gone. What holds now:

- `DEFAULT_MAX_LINKS` (5) and `DEFAULT_MAX_ERRORS` (100) apply when `SerializeErrorOptions.maxLinks`/`maxErrors` are omitted. `serializeLink` cuts when `links > state.maxLinks`; `serializeErrors` slices at `state.maxErrors`. The counting rule is unchanged (outermost is link 0, a link into `errors` counts as one link).
- The same options object reaches every bound site: `makeErrorLeaf` and `makeThrownValueLeaf` (engine `Bounds`) and `normalizeAttributes` for each link's `data`. A new bound site that skips `state.options` silently keeps the defaults.
- `createState` builds the truncated-chain marker per call, so its message ("the chain continues past N links") states the limit that call used.
- common does not validate option values; a NaN reaches the engine as given.
