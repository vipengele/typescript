---
description: State shared across every resolved copy of a package lives behind a `globalThis` slot keyed by `Symbol.for`, never a module-level variable.
---

# Shared realm state lives behind a `globalThis` slot keyed by `Symbol.for`, never module-level state

A `const` or `let` at module scope gives every resolved copy of a package its own instance —
differing peer ranges are enough to produce two copies in one app. State that must be the same
value everywhere in the realm (a context carrier, the logger's level table) has to live somewhere
every copy reads and writes in common. `globalThis`, keyed by `Symbol.for` so the key itself is
shared across copies, is that place; a plain string property risks colliding with something else
on `globalThis`.

## Applies to

Any `@vipengele/*` package module that needs one shared value or handle across every copy of
itself in a realm, not just within its own module instance.

## Example

```ts
// ✓ source/core/packages/common/src/context/global-registry.ts
export function getOrCreateRegistryEntry<T>(key: string, createDefault: () => ContextCarrier<T>): RegistryEntry<T> {
  const slot = Symbol.for(`vipengele:async-context-store:${key}`);
  const registry = globalThis as unknown as Record<symbol, unknown>;
  if (registry[slot] === undefined) {
    registry[slot] = createDefault();
  }
  return { get: () => registry[slot] as ContextCarrier<T>, set: (carrier) => { registry[slot] = carrier; } };
}

// ✗ let carrier: ContextCarrier<T> | undefined;
// a module-level variable — a second resolved copy of the package gets its own `carrier`,
// silently propagating a context the first copy never sees.
```

The first caller to reach the slot picks the value (or, for a carrier, the default and the
carrier); a later caller's `createDefault` is never invoked, and any caller can still replace the
slot's value through a setter, visible to every handle on the key.
