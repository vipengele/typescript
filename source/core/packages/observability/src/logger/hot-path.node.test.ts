import { afterEach, describe, expect, test } from "vitest";
import { createLoggerProvider } from "./provider";

// The package declares no Node types and lint rejects both the bare `process` global and a
// `node:` import specifier, so `process` is typed here for the one method this suite reads.
// `performance` and `PerformanceObserver` are globals in Node and typed by the DOM library.
const nodeProcess = (globalThis as unknown as { process: { memoryUsage(): { heapUsed: number } } }).process;

const WARM_UP_CALLS = 20_000;
const MEASURED_CALLS = 100_000;
const ATTEMPTS = 3;

/**
 * The most the heap may grow over {@link MEASURED_CALLS} disabled calls. A call that allocated
 * even one small object would grow it by megabytes; the margin absorbs the test runner's own
 * background allocation.
 */
const MAX_GROWTH_BYTES = 256 * 1024;

/** Start times of every garbage collection seen while the observer is connected. */
const collections: number[] = [];
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    collections.push(entry.startTime);
  }
});

const REGISTRY_SLOT = Symbol.for("opentelemetry.js.api.1");
const registry = globalThis as unknown as Record<symbol, unknown>;

afterEach(() => {
  observer.disconnect();
  collections.length = 0;
  delete registry[REGISTRY_SLOT];
});

/**
 * Whether a garbage collection started between `start` and `end`. A collection during a measured
 * loop frees what the loop allocated, so the heap's growth over that loop no longer bounds the
 * loop's allocation: an allocating call can then show a small or negative growth. Gc entries are
 * delivered asynchronously, so this waits for them first.
 */
async function collectedBetween(start: number, end: number): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, 20));
  return collections.some((time) => time >= start && time <= end);
}

describe("a disabled call's heap cost", () => {
  test("a disabled debug call with a hoisted thunk grows the heap by no more than a fixed margin and reads no trace", async () => {
    observer.observe({ entryTypes: ["gc"] });
    // An OpenTelemetry registry whose `context` getter counts its reads: a disabled call reads none.
    let registryReads = 0;
    registry[REGISTRY_SLOT] = {
      get context() {
        registryReads++;
        return undefined;
      },
    };
    const provider = createLoggerProvider((b) => b.addLevels({ "*": "info" }).addSink({ write: () => {} }));
    const logger = provider.logger("hot.path").with(() => ({ bound: 1 }));
    // One thunk for every call: an arrow written inline at the call site is a closure the caller
    // allocates on each call, whatever the logger does with it.
    const thunk = (): Record<string, unknown> => ({ computed: 1 });

    for (let i = 0; i < WARM_UP_CALLS; i++) {
      logger.debug("hot", thunk);
    }

    // Only an attempt with no collection inside it is measured, since a collection can hide the
    // loop's allocation; a few attempts absorb a collection the runner causes on its own. An
    // allocating call either grows the heap past the margin or triggers a collection in every
    // attempt, and fails both ways.
    const growths: number[] = [];
    for (let attempt = 0; attempt < ATTEMPTS && growths.length === 0; attempt++) {
      const start = performance.now();
      const before = nodeProcess.memoryUsage().heapUsed;
      for (let i = 0; i < MEASURED_CALLS; i++) {
        logger.debug("hot", thunk);
      }
      const after = nodeProcess.memoryUsage().heapUsed;
      const end = performance.now();
      if (!(await collectedBetween(start, end))) {
        growths.push(after - before);
      }
    }

    expect(growths).toHaveLength(1);
    expect(growths[0]).toBeLessThan(MAX_GROWTH_BYTES);
    expect(registryReads).toBe(0);
  });
});
