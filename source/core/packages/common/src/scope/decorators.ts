import type { ScopeAttributes } from "./root";
import { Scope } from "./scope";

type Method<This, Args extends unknown[], R> = (this: This, ...args: Args) => R;

/**
 * A method decorator usable under either decorator dialect: the standard one, which calls it with
 * the method and a context object, and TypeScript's `experimentalDecorators`, which calls it with
 * the prototype (or constructor), the property key and the property descriptor.
 */
export interface ScopeMethodDecorator {
  <This, Args extends unknown[], R>(
    method: Method<This, Args, R>,
    context: ClassMethodDecoratorContext<This, Method<This, Args, R>>,
  ): Method<This, Args, R>;
  <This, Args extends unknown[], R>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<Method<This, Args, R>>,
  ): TypedPropertyDescriptor<Method<This, Args, R>>;
}

/**
 * Builds a decorator that replaces a method with `wrap(method)`.
 *
 * The dialect is read off the second argument: a standard decorator always receives a context
 * object there, and a legacy one always receives the property key, a string or a symbol. A standard
 * decorator's return value becomes the method; a legacy one's becomes the property descriptor.
 */
function methodDecorator(
  wrap: <This, Args extends unknown[], R>(method: Method<This, Args, R>) => Method<This, Args, R>,
): ScopeMethodDecorator {
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
  return decorate as ScopeMethodDecorator;
}

/**
 * Runs every call of the decorated method in {@link Scope.isolated}: a new Unit of Work whose scope,
 * tagged `tag`, is a child of the root whatever scope is current at the call.
 *
 * The method's return value passes through untouched, so an `async` method's promise is the one its
 * caller awaits. Its scope is current across that method's `await`s wherever the carrier follows
 * them, and only up to the first `await` under the synchronous fallback — exactly as with
 * {@link Scope.isolated} itself.
 */
export function isolatedScope(tag: string): ScopeMethodDecorator {
  return methodDecorator(
    (method) =>
      function (this, ...args) {
        return Scope.isolated(tag, {}, () => method.apply(this, args));
      },
  );
}

/**
 * Runs every call of the decorated method in {@link Scope.inherit}: a scope tagged `tag`, holding
 * `attributes`, as a child of whatever scope is current at the call.
 *
 * The method's return value passes through untouched, so an `async` method's promise is the one its
 * caller awaits. Its scope is current across that method's `await`s wherever the carrier follows
 * them, and only up to the first `await` under the synchronous fallback — exactly as with
 * {@link Scope.inherit} itself.
 *
 * @throws {ReservedScopeKeyError} at each call, before the method runs, when `attributes` holds a key the root holds.
 */
export function scoped(tag: string, attributes: ScopeAttributes): ScopeMethodDecorator {
  return methodDecorator(
    (method) =>
      function (this, ...args) {
        return Scope.inherit(tag, attributes, () => method.apply(this, args));
      },
  );
}
