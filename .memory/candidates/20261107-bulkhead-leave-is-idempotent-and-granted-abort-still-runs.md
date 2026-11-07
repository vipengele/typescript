---
about: "bulkhead queue removal is guarded against a late sleep, and a granted waiter whose signal aborts still runs its op"
saw:
  - source/core/packages/resilience/src/bulkhead/bulkhead.ts
---

- `leave` looks the waiter up in the queue and does nothing when it is gone (bulkhead.ts `leave`). A scheduler may resolve a wait sleep whose abort came too late; without the guard the timeout path would reject an already-granted call and splice the wrong entry. Manual time never does this, so a stub scheduler that ignores abort covers it in bulkhead.test.ts.
- `release` hands the permit to the queue head without touching `running`; `running` only drops when nobody waits (bulkhead.ts `release`).
- A queued caller granted a permit whose signal aborts before `op` starts still runs `op` with the aborted signal and holds the permit until `op` settles (bulkhead.ts `run`: no `throwIfAborted` after the wait). Same rule as a running caller: an abort never releases a permit early.
