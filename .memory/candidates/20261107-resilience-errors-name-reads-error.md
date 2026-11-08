---
about: "resilience errors never set name, so error.name is \"Error\", not the class name"
saw:
  - source/core/packages/resilience/src/errors/resilience-errors.ts
  - source/core/packages/resilience/src/errors/resilience-errors.test.ts
---

- No class in resilience-errors.ts assigns `name`, and `VipengeleError` does not either, so `new BulkheadFullError(...).name === "Error"`. resilience-errors.test.ts asserts `"Error"` for `RateLimitExceededError` and `BulkheadFullError`. A plan saying "`name` is still the class name" is wrong for this package; detail fields avoid the key `name` because `Error#name` owns it.
