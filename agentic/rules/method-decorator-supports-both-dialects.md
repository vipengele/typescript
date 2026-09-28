---
description: A method decorator is told the calling dialect by its second argument's type and returns what that dialect expects, so it works whether or not a consumer's tsconfig sets experimentalDecorators.
---

# A method decorator supports both the standard and legacy TC39 dialects

A package here has no control over whether the application consuming it compiles with
`experimentalDecorators`, so a decorator it exports has to work under both call conventions rather
than picking one. The two dialects are told apart by the shape of the second argument: a standard
decorator always receives a context object there, a legacy one always receives the property key (a
string or a symbol). A standard decorator returns the replacement method; a legacy one returns the
replacement property descriptor.

## Applies to

Any exported method decorator in an `@vipengele/*` package (`isolatedScope`, `scoped` in
`source/core/packages/common/src/scope/decorators.ts`, and any decorator added after them).

## Example

```ts
function decorate<This, Args extends unknown[], R>(
  methodOrTarget: Method<This, Args, R> | object,
  contextOrKey: ClassMethodDecoratorContext<This, Method<This, Args, R>> | string | symbol,
  descriptor?: TypedPropertyDescriptor<Method<This, Args, R>>,
): Method<This, Args, R> | TypedPropertyDescriptor<Method<This, Args, R>> {
  if (typeof contextOrKey === "object") {
    return wrap(methodOrTarget as Method<This, Args, R>);
  }
  const legacy = descriptor as TypedPropertyDescriptor<Method<This, Args, R>>;
  return { ...legacy, value: wrap(legacy.value as Method<This, Args, R>) };
}
```

Branching on anything other than the second argument's type — a compiler flag, a runtime feature
check — picks a dialect for every consumer instead of reading which one is actually calling.
