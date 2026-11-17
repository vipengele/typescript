---
name: http-one-shot-body-is-marked-sent-before-fetch
kind: gotcha
description: http dispatch records a one-shot body as sent, realm-wide, before calling fetch, so even a network failure consumes it; a retry or replay must check ctx.replayable and never retry HttpConfigError.
anchors:
  - path: source/core/packages/http/src/dispatch.ts
    blob: 3bbab496ce14
  - path: source/core/packages/http/src/context.ts
    blob: c11a982fbf80
  - path: source/core/packages/http/src/resilience/predicates.ts
    blob: 674bd7235599
confidence: verified
---

`dispatch` (`source/core/packages/http/src/dispatch.ts:63-69`) rejects a second send of the same
stream or async-iterable body with `HttpConfigError` and calls `markSent` before `fetch`. The
record is one `WeakSet` behind `Symbol.for("vipengele:http:sent-one-shot-bodies")`
(`source/core/packages/http/src/context.ts:41-45`), realm-wide, not per call or per fork.

So a failed first attempt still consumes the body, and attempt two fails before the network.
resilience's default retry would retry that error, which is why `defaultRetryPredicate`
(`source/core/packages/http/src/resilience/predicates.ts`) declines `HttpConfigError` (`:86`) and
stops when `!base.replayable` (`:124`). A custom `shouldRetry`, or any filter that calls `next`
twice (an auth replay), must keep both checks and return the first Response untouched for a
one-shot body.

Also in `dispatch.ts`: an async-iterable body is always wrapped with `toReadableStream` (`:69`),
because a browser `fetch` given an async iterable sends `"[object Object]"` and fake-fetch tests
cannot see that; and the default fetch is called through an arrow (`:28-38`), because a native
`fetch` invoked with another `this` throws "Illegal invocation".
