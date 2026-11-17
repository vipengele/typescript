---
name: http-transport-untimed-flush-hangs-on-synchronous-drop
kind: gotcha
description: An untimed createHttpTransport flush() may never resolve when the flush itself starts a batch that drops synchronously, because the flush waiter is registered after startSending().
anchors:
  - path: source/core/packages/observability/src/errors/transports/http-transport.ts
    blob: 8f89e4d82bba
  - path: source/core/packages/observability/src/errors/transports/http/request.ts
    blob: d7d5896c698a
confidence: suspect
---

Checked in code: `flushAccepted` in
`source/core/packages/observability/src/errors/transports/http-transport.ts` calls
`startSending()` (`:369`) before it adds its `FlushWaiter` (`:380`). `sendBatch` can settle a
batch before its first `await`: with no `fetch` it records `"unsendable"` at once
(`http/request.ts:293-295`), and a throwing `serialize` gives `"unsendable"` synchronously in
`settle` (`http/request.ts:245-254`, `:98-104`).

Reported, not reproduced here: in that case the settlement runs while `waiters` is empty, the
waiter registered next waits for a count already reached, and with no `timeoutMs` (`:381`) the
promise never resolves. Existing tests avoid it by letting the linger timer start the batch
before flushing. Registering the waiter before `startSending()` is the likely fix.
