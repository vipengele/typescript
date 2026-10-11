# @vipengele/ts-core-resilience

Resilience primitives for the browser and Node: timeouts, retries and the typed errors they raise.

```sh
pnpm add @vipengele/ts-core-resilience
```

Runs in the browser and in Node 24+. ESM only, side-effect free.

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
