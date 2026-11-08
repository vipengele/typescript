# Automatic breadcrumbs patch each global once per realm

`autoBreadcrumbs` is an `Integration` (ADR-0012) that records Breadcrumbs (ADR-0027) from the
runtime's own globals: `console`, `fetch`, `XMLHttpRequest`, `history` and clicks on `document`.
This records how those globals are wrapped, how the package's own traffic stays out of the trail,
and where a recorded URL is redacted. It narrows item 8 of `0027-breadcrumbs-are-a-bounded-buffer-per-unit-of-work.md`.

## Context

A Reporter that installs an Integration owns the effect until `close()` (ADR-0012). `globalHandlers`
adds listeners, and a second install adds a second set of listeners, which is harmless: each
Reporter is its own destination. Wrapping a global is different. A second install wraps the first
wrapper, so one `fetch` call records twice, and teardown out of order can restore a stale original
over a live wrapper. Several Reporters, or several resolved copies of the package, are ordinary in
one realm.

## Decisions

1. **Each global is instrumented at most once per realm.** A type (console, fetch, xhr, navigation,
   clicks) is installed through a slot on `globalThis` keyed
   `Symbol.for("vipengele:breadcrumbs:instrumentation:<type>:v1")`
   (`agentic/rules/shared-realm-state-lives-behind-a-globalthis-symbol-slot.md`). The first install
   patches the global. Every install, first or later, appends itself to the slot's install list.
   Every event is recorded exactly once, however many Reporters or copies installed.
2. **The oldest live install's options apply**, looked up when the wrapped API is called, not when it
   was installed. Tearing an install down removes it from the list and hands over to the next. When
   the list empties the slot forgets its patch and the patch's restore runs. The restore owns the
   check, property by property: it puts an original back only where the global still holds our
   wrapper. If something else has wrapped it since, our wrapper stays in place beneath it and passes
   through inertly, because restoring would remove the other party's wrapper.
3. **Patching is per property and fallible.** Each assignment (one per console method, `fetch`, each
   `XMLHttpRequest.prototype` method, each `history` method) is tried on its own. One that throws,
   on a frozen or accessor property, is skipped, and only what was actually patched is restored. A
   type whose every assignment failed does not join the list.
4. **The slot contract is the cross-copy contract.** The `:v1` in each key is its version. A slot is
   `{ installs: InstallEntry[], patch: { restore } | undefined }`, and an `InstallEntry` is
   `{ options }`, where `options` carries the per-type option fields (`clock`, the redaction policy,
   and the type's own toggles such as `selectorAttributes`). The `patch` object's identity marks
   which patch is current. A wrapper reads its options through the reader its own patch was given,
   and the reader gives the oldest install's options only while the slot's `patch` is still that
   patch, and nothing once it is not. A wrapper left inert under someone else's wrapper therefore
   never records alongside a newer patch of the same type. An entry may come from another copy of
   the package, so a reader defaults any option field it finds missing: `systemClock` for a `clock`,
   `secretKeys` for a `redaction`. Copies agree on that shape and nothing else: a change to it takes
   a new key, as with `vipengele.logger.provider.v1`. State a patch needs between calls, such as
   navigation's last-known URL, lives in that patch's closure: only one patch per type is current in
   a realm, so nothing else reads it. Navigation's starts at `location.href` when the patch is made
   and follows every navigation the patch sees, suppressed ones included, so a suppressed navigation
   does not make the next one report a stale origin.
5. **The package's own traffic is suppressed, not matched.** A counter in a
   `Symbol.for("vipengele:breadcrumbs:suppressed:v1")` slot, read through `breadcrumbsSuppressed()`
   and raised by `suppressBreadcrumbs(fn)`, lives in `src/breadcrumb-suppression.ts`. It sits outside
   `src/errors/` because the logger calls it and the logger may not import `./errors`. Each place
   the package invokes `fetch` or a `console` method runs inside `suppressBreadcrumbs`. A wrapper
   reads the counter when the call starts (for XHR, at `send`) and carries the answer to
   settlement: a request started while suppressed records nothing when it settles, whatever the
   counter says by then. The helpers
   are internal and not exported.
6. **A recorded URL is redacted at record time.** Fetch, XHR and navigation crumbs pass their URLs
   through `redactUrl` from `@vipengele/ts-core-redaction`, with `secretKeys` unless the
   integration's `redaction` option names another policy. A URL the policy fails on is replaced
   whole by a placeholder. The buffer never holds a raw URL.
7. **A request's crumb records into the Unit of Work that started it.** A fetch or XHR wrapper
   captures the current Scope when the request starts (for XHR, at `send`) and records there when
   it settles, wherever the settlement runs. The options, the suppression answer and the start time
   are read at the same moment, so a request that settles after every install is torn down still
   records with what it started under.
   Event-time redaction (ADR-0027 item 8) still runs over the crumb on top.

## Narrowing ADR-0027 item 8

ADR-0027 item 8 redacts a crumb's `message` and `data` only in the pipeline's redaction stage, at
attach time. That holds for crumbs whose text is already a Log Record's, which the logger redacted.
A URL is raw input from the page: a token in a query string would sit in the shared buffer, and be
visible to anything that reads the trail, until an event carried it out. The URLs in fetch, XHR and
navigation crumbs are therefore redacted before they are stored (item 6). A console crumb's message
and a click crumb's selector are stored as rendered and redacted at attach time by the pipeline's
redaction stage, as item 8 redacts any crumb added with `addBreadcrumb`. Nothing else about item 8
changes.

## Why ADR-0012's no-guard rule does not carry over

ADR-0012 declines a `Symbol.for` guard on `globalHandlers` because the second Reporter "would silently
capture nothing": each Reporter is its own destination, and each listener sees every error. A
patch of a global has no such independence. Every Reporter reads one shared trail (ADR-0027 item 7),
so a second wrapper records into the buffer the first already fills, and the trail would hold each
event twice. One patch per realm gives every Reporter the whole trail. The guard costs no capture.

## Considered options

- **Wrap per install.** Each Reporter wraps whatever it finds. Calls record once per wrapper into
  the same trail, and teardown in any order but newest first restores a stale original over a live
  wrapper.
- **First install wins.** The first install's options apply for as long as the patch lives. After
  that Reporter closes, the others would silently use a clock and redaction policy nobody on the
  list chose. Handing over to the oldest live install keeps the options of a Reporter that exists.
- **Matching the package's own endpoints to skip self-traffic.** Transports send to consumer-chosen
  URLs, a consumer may inject its own `fetch`, and console output has no endpoint. A URL match would
  miss some and hide a consumer's own request to the same host. The suppression counter marks the
  call, not the destination.
- **Exposing the Reporter's policy to integrations.** Handing an integration the Reporter's
  redaction policy and clock would let the crumb follow the Reporter that installed it, but several
  Reporters share one patch and one trail, so there is no single Reporter to follow. The
  integration takes its own `redaction` and `clock`, and the host stays what ADR-0012 gave it.

## Consequences

- Installing `autoBreadcrumbs` on a second Reporter, or from a second copy of the package, adds no
  second wrapper and no duplicate crumb.
- A Reporter that installs `autoBreadcrumbs` and a Reporter that does not still share the trail
  the patch fills; the trail belongs to the Unit of Work, not to an installer.
- The options of the oldest live install apply to every Reporter's crumbs, so two Reporters that
  want different redaction policies for automatic crumbs cannot have both.
- A fetch or XHR that settles after every install is torn down still records, with the options it
  saw when it started.
- A console crumb holds the logged text, unredacted, in the shared trail until an event attaches
  it. Anything that reads the raw trail before the redaction stage sees that text: `breadcrumbs()`
  from `@vipengele/ts-core-common/scope`, and a Reporter's `beforeBreadcrumb` hook, which runs in
  the enrich stage ahead of redaction. A secret logged to the console is masked in the event, not
  in the buffer.
