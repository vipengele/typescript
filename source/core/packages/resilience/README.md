# @vipengele/ts-core-resilience

Resilience primitives for the browser and Node: timeouts, retries and the typed errors they raise.

| Entry point | What it holds |
|-------------|---------------|
| `@vipengele/ts-core-resilience/timeout` | `createTimeout`, the `TimeoutPolicy` and its events |
| `@vipengele/ts-core-resilience/retry` | `createRetry`, the backoff strategies and the `RetryPolicy` and its events |
| `@vipengele/ts-core-resilience/errors` | The errors the package raises, with their guards |
| `@vipengele/ts-core-resilience` | All of the above |

```sh
pnpm add @vipengele/ts-core-resilience
```

Runs in the browser and in Node 24+. ESM only, side-effect free.

## Policies

A policy has a `name` and `execute(op, options?)`. `op` receives `{ attempt, signal }` (`attempt` is
1-based) and may return a value or a promise; `execute` returns a promise of the same value.
`options.signal` is the caller's `AbortSignal`.

## `./timeout`

```ts
import { createTimeout } from "@vipengele/ts-core-resilience/timeout";

const timeout = createTimeout("profile.fetch", { durationMs: 2_000 });

const response = await timeout.execute(({ signal }) => fetch("https://example.com/profile", { signal }));
```

The attempt is abandoned once it has run for `durationMs` (finite, above 0, at most
`MAX_TIMEOUT_DURATION_MS`). The policy then rejects with an `OperationTimeoutError` and aborts `signal`
with that same error. The operation has to pass `signal` on to whatever it awaits: a timeout stops
waiting for work that ignores `signal`, it cannot stop the work. The signal also aborts when the
caller's `options.signal` does.

`events` reports each abandoned attempt:

```ts
const unsubscribe = timeout.events.on((event) => {
  console.warn(`${event.name} timed out after ${event.durationMs} ms`); // event.kind === "timeout"
});

unsubscribe();
```

## `./retry`

```ts
import { createRetry, exponentialBackoff, withJitter } from "@vipengele/ts-core-resilience/retry";

const retry = createRetry("profile.fetch", {
  maxAttempts: 4,
  backoff: withJitter(exponentialBackoff({ initialMs: 100, maxMs: 5_000 }), "full"),
});

const profile = await retry.execute(async ({ attempt, signal }) => {
  const response = await fetch(`https://example.com/profile?attempt=${attempt}`, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
});
```

`maxAttempts` counts the first attempt. After a failed attempt the policy waits for `backoff` (given
the 1-based number of the attempt that just failed) and runs `op` again. The error of the last attempt
is rethrown as the very value `op` threw.

- **Backoff** — `fixedBackoff(ms)`, `exponentialBackoff({ initialMs, multiplier = 2, maxMs? })` and
  `withJitter(strategy, "full" | "equal")`. A bad number throws `ResilienceConfigError` where it is
  written.
- **`shouldRetry(outcome, attempt)`** — an `Outcome` is `{ ok: true, value }` or
  `{ ok: false, error }`. The default retries every error, `OperationTimeoutError` included, except
  `CircuitOpenError`, `RateLimitExceededError` and `BulkheadFullError`, and never retries an `ok`
  outcome.
- **`retryAfter(outcome, attempt)`** — a delay in milliseconds that overrides `backoff`; return
  `undefined` to fall back to it.
- **Abort** — `execute(op, { signal })` checks the signal before the first attempt and after each
  failed one, and cuts the wait between attempts short. Each rejects with the signal's reason.

```ts
const controller = new AbortController();
const result = retry.execute(({ signal }) => fetch("https://example.com/profile", { signal }), {
  signal: controller.signal,
});
controller.abort();
```

`events` reports what the policy decided:

```ts
retry.events.on((event) => {
  if (event.kind === "retry") {
    console.warn(`${event.name}: attempt ${event.attempt} failed, retrying in ${event.delayMs} ms`);
  } else {
    console.error(`${event.name}: gave up after ${event.attempts} attempts`); // "retry-exhausted"
  }
});
```

`retry-exhausted` is emitted only when `shouldRetry` wanted another attempt and none was left.

## Timeout and retry together

Policies compose by nesting calls. A timeout inside the retry's operation bounds each attempt, and the
default `shouldRetry` retries the resulting `OperationTimeoutError`:

```ts
const perAttempt = createTimeout("profile.attempt", { durationMs: 2_000 });

const body = await retry.execute((ctx) =>
  perAttempt.execute(({ signal }) => fetch("https://example.com/profile", { signal }).then((r) => r.text()), {
    signal: ctx.signal,
  }),
);
```

## Errors

`@vipengele/ts-core-resilience/errors` (also re-exported from the package root) holds the errors the
package raises. Each extends the abstract `ResilienceError`, carries a fixed `code`, and has a paired
type-guard. Check an error with the guard, never `instanceof`: two resolved copies of the package give
the same source two class identities, and the guard compares `code`.

| Error | Code | Guard |
|-------|------|-------|
| `CircuitOpenError` | `resilience.circuit-open` | `isCircuitOpenError` |
| `RateLimitExceededError` | `resilience.rate-limit-exceeded` | `isRateLimitExceededError` |
| `BulkheadFullError` | `resilience.bulkhead-full` | `isBulkheadFullError` |
| `OperationTimeoutError` | `resilience.timeout` | `isOperationTimeoutError` |
| `ResilienceConfigError` | `resilience.config` | `isResilienceConfigError` |

`isResilienceError` matches any error whose `code` starts with `resilience.`.

```ts
import { isOperationTimeoutError } from "@vipengele/ts-core-resilience/errors";

try {
  await work();
} catch (error) {
  if (isOperationTimeoutError(error)) {
    console.warn(`gave up after ${error.durationMs} ms`);
  }
}
```

`OperationTimeoutError` takes `(message, durationMs, options?)`; every other error takes
`(message, options?)`, where `options` is the standard `ErrorOptions` (`cause`).
