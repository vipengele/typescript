# Logger sampling and rate limits drop before the record is built

A hot loop at `debug` can flood a Sink. The Logger samples and rate-limits Log Records per category,
configured from the builder (`sample`, `rateLimit`, `random`) and from spec strings. This is a policy
drop in the sense of `0020-the-reporter-owns-policy-drops-and-the-transport-owns-delivery-drops.md`:
the Logger settles it before any Sink sees the record.

## The drop point

The check sits in `bindLogger.log()`, after the level check and after the no-sink early return, and
before the record is built. A dropped call runs no attribute thunk
(`0019-lazy-logger-attributes-run-once-per-written-record.md`), no Scope read, no `serializeError`
and no redaction. The console handle's confirmation record goes straight to `emitRecord`, so it is
never sampled or limited.

This inverts `0020`. The Reporter's rate limit runs last, protects the backend and saves only tokens,
because an error is rare and the work of building its event is acceptable. Log volume is the threat
here: a flooded call site would pay for every record it then discards. The Logger saves the pipeline's
work, not only tokens.

## Rules

- **Order.** Sampling first, then the rate limit. A sampled-out record takes no token.
- **Level exemption.** A rule applies to `trace`, `debug` and `info` by default; `warn` and above
  always pass. `upTo` (`upto=` in a spec) names the highest level the rule applies to. This is the
  counterpart of the Reporter's unhandled-event bypass: the records an application most needs to see
  are never withheld.
- **One bucket per rule.** A rule is a token bucket shared by every category it governs, not one per
  category. `db:debug;limit=20/60` caps all of `db` and its descendants together.
- **Dropped count.** A rate-limit drop is counted per rule. The next record the rule admits carries
  `vipengele.logger.dropped: n`, written after the call attributes so it beats a caller attribute of
  the same name, and the counter resets once that record is built. A failed build keeps the count,
  and a processor that drops the admitted record afterwards loses it. Sampling drops are not
  counted.
- **Clock.** The clock is read once, in the admission step under its own guard, and only when a limit
  rule applies. That time is passed to `emitRecord` as a trailing optional parameter and becomes the
  record's `time`. A throwing clock drops the record silently, takes no token and is not counted.

## Configuration

A spec entry takes modifiers after the level: `db:debug;sample=0.1;limit=20/60;upto=info`. `limit`
is `burst/perMinute`. `limit=off` and `sample=1` clear an inherited rule. A bad modifier in `addSpec`,
`VPG_LOG` or a browser source is skipped with an issue and the entry's level still applies. The console
handle keeps its strict rule: any issue raises `LoggingConfigError` and nothing changes.

Policies are layered like levels: defaults, then the builder, then overrides, then the environment,
each later layer winning. Only the console handle's spec string feeds the overrides layer;
`Logging.override(category, null)` touches levels only, and `handle(null)` clears both level and
policy overrides.

Bucket and drop-count state lives in the provider, with no new `globalThis` slot. It is keyed by the
rule's key and value and carried across every commit (configure, override, handle, settle) while the
rule is unchanged, and it resets when that rule changes. Without the carry-over a `Logging.override`
or the first level check would refill every bucket.

## Considered options

- **A processor-based drop.** A Log Processor (`0017-logger-processors-fail-closed-after-built-in-redaction.md`)
  runs after the record is built and redacted, so the cost the rule exists to avoid is already paid.
  A processor also sees one sink's record, not the call.
- **Per-category buckets.** A rule over a prefix would give each descendant category its own burst, so
  the cap grows with the number of categories under it. One shared bucket bounds what the rule governs.
- **A separate environment variable.** A second variable beside `VPG_LOG` would need its own
  parsing, its own sources and its own layering. Modifiers on the spec entry keep a category's level
  and policy in one place.
- **A synthetic summary record.** A "n records dropped" record written on a timer or at the next
  admission needs a timer or invents a record the caller never logged. An attribute on the next
  admitted record needs neither.

## Consequences

- A sampled or limited call costs the level check, the sampling draw and a bucket take.
- The dropped count lands on whichever category the rule next admits, which may not be the category
  that was dropped.
- If a newer copy's `configure` runs against an older copy's default provider, the builder lacks
  `sample` and `rateLimit`. This is accepted: every copy shares one default provider through
  `vipengele.logger.provider.v1`, and an older copy also skips a spec entry carrying modifiers.
