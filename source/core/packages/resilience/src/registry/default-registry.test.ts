import { createManualTime } from "@vipengele/ts-core-common/testing";
import { afterEach, describe, expect, test } from "vitest";
import { isResilienceConfigError } from "../errors";
import type { RegistryBuilder } from "./builder";
import { defaultRegistry } from "./default-registry";

const REGISTRY_SLOT = Symbol.for("vipengele.resilience.registry.v1");

function slot(): unknown {
  return (globalThis as unknown as Record<symbol, unknown>)[REGISTRY_SLOT];
}

function errorOf(run: () => unknown): unknown {
  try {
    run();
  } catch (caught) {
    return caught;
  }
  return undefined;
}

afterEach(() => {
  delete (globalThis as unknown as Record<symbol, unknown>)[REGISTRY_SLOT];
});

describe("defaultRegistry", () => {
  test("importing the module leaves the slot empty", () => {
    expect(slot()).toBeUndefined();
  });

  test("repeated calls return the same instance, stored in the slot", () => {
    const first = defaultRegistry();

    expect(defaultRegistry()).toBe(first);
    expect(slot()).toBe(first);
    expect(first.circuitBreaker("api")).toBe(defaultRegistry().circuitBreaker("api"));
  });

  test("the first call's build configures the shared registry, chaining through the builder", () => {
    let returned: RegistryBuilder | undefined;
    let passed: RegistryBuilder | undefined;
    const registry = defaultRegistry((builder) => {
      passed = builder;
      returned = builder
        .defaults("timeout", { durationMs: 250 })
        .configure("bulkhead", "db", { maxConcurrent: 2 })
        .fromConfig({ configure: { retry: { api: { maxAttempts: 5 } } } });
    });

    expect(returned).toBe(passed);
    expect(registry.bulkhead("db").available).toBe(2);
    expect(registry.pipeline("api").name).toBe("api");
  });

  test("a build passed once the registry exists throws a ResilienceConfigError", () => {
    const registry = defaultRegistry();
    let ran = false;

    const error = errorOf(() =>
      defaultRegistry(() => {
        ran = true;
      }),
    );

    expect(isResilienceConfigError(error)).toBe(true);
    expect(ran).toBe(false);
    expect(defaultRegistry()).toBe(registry);
  });

  test.each(["clock", "scheduler"] as const)("%s inside the build throws a ResilienceConfigError", (method) => {
    const time = createManualTime();

    const error = errorOf(() =>
      defaultRegistry((builder) => {
        if (method === "clock") {
          builder.clock(time.clock);
        } else {
          builder.scheduler(time.scheduler);
        }
      }),
    );

    expect(isResilienceConfigError(error)).toBe(true);
    expect((error as Error).message).toContain("createRegistry");
  });

  test("a first build that throws leaves the slot empty, so a later call creates the registry", () => {
    const failure = new Error("build failed");

    expect(
      errorOf(() =>
        defaultRegistry(() => {
          throw failure;
        }),
      ),
    ).toBe(failure);
    expect(slot()).toBeUndefined();

    const registry = defaultRegistry((builder) => builder.configure("bulkhead", "db", { maxConcurrent: 3 }));
    expect(registry.bulkhead("db").available).toBe(3);
    expect(slot()).toBe(registry);
  });

  test("a call from inside the first build throws a ResilienceConfigError and the build's own registry fills the slot", () => {
    let inner: unknown;
    const registry = defaultRegistry(() => {
      inner = errorOf(() => defaultRegistry());
    });

    expect(isResilienceConfigError(inner)).toBe(true);
    expect((inner as Error).message).toContain("inside the build");
    expect(slot()).toBe(registry);
    expect(defaultRegistry()).toBe(registry);
  });

  test("a call from inside the first build that lets the error escape leaves the slot empty", () => {
    const error = errorOf(() => defaultRegistry(() => defaultRegistry()));

    expect(isResilienceConfigError(error)).toBe(true);
    expect(slot()).toBeUndefined();
    expect(defaultRegistry()).toBe(slot());
  });

  test("a second module instance called from inside the first build throws too", async () => {
    const specifier = "./default-registry?copy=2";
    const copy: typeof import("./default-registry") = await import(/* @vite-ignore */ specifier);
    let inner: unknown;

    defaultRegistry(() => {
      inner = errorOf(() => copy.defaultRegistry());
    });

    expect(isResilienceConfigError(inner)).toBe(true);
  });

  /**
   * A query-string import is a distinct instance of this module under both runtimes. It proves the
   * copies agree through the slot: it does not load a second copy of the registry or policy code,
   * which the query string leaves shared. Across real copies of the package, the guarantee is
   * carried by the `Symbol.for` key and the module keeping no state of its own.
   */
  test("a second module instance returns the same breaker and sees its state change", async () => {
    const specifier = "./default-registry?copy=1";
    const copy: typeof import("./default-registry") = await import(/* @vite-ignore */ specifier);
    expect(copy.defaultRegistry).not.toBe(defaultRegistry);

    const breaker = defaultRegistry().circuitBreaker("payments");
    const seen = copy.defaultRegistry().circuitBreaker("payments");
    expect(seen).toBe(breaker);

    breaker.forceOpen();
    expect(seen.state).toBe("forced-open");
    expect(isResilienceConfigError(errorOf(() => copy.defaultRegistry(() => undefined)))).toBe(true);
  });
});
