---
about: "http dispatch always turns an async-iterable body into a ReadableStream and calls fetch unbound"
saw:
  - source/core/packages/http/src/dispatch.ts
  - source/core/packages/http/src/body.ts
  - source/core/packages/http/src/context.ts
---
`dispatch` (source/core/packages/http/src/dispatch.ts) wraps an async-iterable body with
`toReadableStream` (body.ts) in both runtimes: a browser `fetch` given an async iterable silently
sends `"[object Object]"`, and fake-fetch tests cannot see that, so passing it through raw looks
fine in tests and is wrong in Chromium. One-shot bodies are marked in a per-call `WeakSet` that
every `fork()` shares (context.ts `markSent`/`wasSent`); a second dispatch of the same object
rejects with `HttpConfigError` before `fetch`. `resolveFetch` wraps the fetch in an arrow because a
native browser `fetch` called with `this` other than `window` throws "Illegal invocation"; the
default reads `globalThis.fetch` at each call. `isOneShotBody` checks for a non-null object before
`Symbol.asyncIterator in body`, since `in` throws on a string.
