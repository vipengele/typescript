import type { Level } from "@vipengele/ts-core-common";
import { Scope } from "@vipengele/ts-core-common/scope";
import { afterEach, describe, expect, test, vi } from "vitest";
import { redactAttributes } from "../redaction";
import { entryFor } from "./levels";
import { createLogger, type Logger } from "./logger";
import { createLoggerProvider } from "./provider";
import type { EmitSettings, Sink } from "./record";

vi.mock("../redaction", { spy: true });

const REGISTRY_SLOT = Symbol.for("opentelemetry.js.api.1");
const registry = globalThis as unknown as Record<symbol, unknown>;

/** How many times the OpenTelemetry registry's `context` has been read since it was installed. */
let registryReads = 0;

/** Installs a fake OpenTelemetry registry whose `context` getter counts its reads and has no active span. */
function installRegistry(): void {
  registryReads = 0;
  registry[REGISTRY_SLOT] = {
    get context() {
      registryReads++;
      return undefined;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete registry[REGISTRY_SLOT];
});

/** Calls each of the six emit methods once, every one passing `thunk` as its attributes. */
function callEveryMethod(logger: Logger, thunk: () => Record<string, unknown>): void {
  const error = new Error("boom");
  logger.trace("m", thunk);
  logger.debug("m", thunk);
  logger.info("m", thunk);
  logger.warn("m", error, thunk);
  logger.error("m", error, thunk);
  logger.fatal("m", error, thunk);
}

describe("a disabled call", () => {
  test("never reads the emit settings, runs no thunk and reads no Scope or trace, for any of the six methods", () => {
    const emit = vi.fn((): EmitSettings => {
      throw new Error("a disabled call never reads the emit settings");
    });
    const thunk = vi.fn(() => ({ computed: 1 }));
    const bound = vi.fn(() => ({ bound: 1 }));
    const current = vi.spyOn(Scope, "current");
    const resource = vi.spyOn(Scope, "resource");
    const logger = createLogger("a.b", () => entryFor("off"), emit).with(bound);
    installRegistry();

    callEveryMethod(logger, thunk);

    expect(emit).not.toHaveBeenCalled();
    expect(registryReads).toBe(0);
    expect(thunk).not.toHaveBeenCalled();
    expect(bound).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    expect(resource).not.toHaveBeenCalled();
  });

  test("never runs a thunk below the threshold while the levels above it are written", () => {
    const write = vi.fn();
    const sink: Sink = { write };
    const clock = vi.fn(() => 0);
    const provider = createLoggerProvider((b) => b.addLevels({ "*": "error" }).addSink(sink).clock(clock));
    const thunk = vi.fn(() => ({ computed: 1 }));
    const bound = vi.fn(() => ({ bound: 1 }));
    const current = vi.spyOn(Scope, "current");
    const logger = provider.logger("a.b").with(bound);
    installRegistry();

    for (const level of ["trace", "debug", "info"] as const satisfies readonly Level[]) {
      logger[level]("m", thunk);
    }
    logger.warn("m", new Error("boom"), thunk);

    expect(thunk).not.toHaveBeenCalled();
    expect(bound).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(registryReads).toBe(0);

    logger.error("m", new Error("boom"), thunk);

    expect(thunk).toHaveBeenCalledTimes(1);
    expect(bound).toHaveBeenCalledTimes(1);
    expect(clock).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(registryReads).toBe(1);
  });

  test("with every category off, a provider's Logger runs nothing and reads no trace for any of the six methods", () => {
    const write = vi.fn();
    const clock = vi.fn(() => 0);
    const provider = createLoggerProvider((b) => b.addLevels({ "*": "off" }).addSink({ write }).clock(clock));
    const thunk = vi.fn(() => ({ computed: 1 }));
    const bound = vi.fn(() => ({ bound: 1 }));
    const current = vi.spyOn(Scope, "current");
    const resource = vi.spyOn(Scope, "resource");
    installRegistry();

    callEveryMethod(provider.logger("a.b").with(bound), thunk);

    expect(thunk).not.toHaveBeenCalled();
    expect(bound).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    expect(resource).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(registryReads).toBe(0);
  });
});

describe("an enabled call with no sink", () => {
  test("runs no thunk and reads no clock, no Scope and no trace, for any of the six methods", () => {
    const clock = vi.fn(() => 0);
    const provider = createLoggerProvider((b) => b.addLevels({ "*": "trace" }).clock(clock));
    const thunk = vi.fn(() => ({ computed: 1 }));
    const bound = vi.fn(() => ({ bound: 1 }));
    const current = vi.spyOn(Scope, "current");
    const resource = vi.spyOn(Scope, "resource");
    const logger = provider.logger("a.b").with(bound);

    expect(logger.enabled("trace")).toBe(true);
    installRegistry();
    callEveryMethod(logger, thunk);

    expect(thunk).not.toHaveBeenCalled();
    expect(bound).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    expect(resource).not.toHaveBeenCalled();
    expect(registryReads).toBe(0);
  });
});

describe("a call the policy drops", () => {
  test("a sampled-out call runs no thunk and reads no clock, Scope or trace, and redacts nothing, while one that is kept builds a record", () => {
    const write = vi.fn();
    const clock = vi.fn(() => 0);
    const draws = [0.9, 0.9, 0.9, 0.1];
    const random = vi.fn(() => draws.shift() as number);
    const provider = createLoggerProvider((b) =>
      b.addLevels({ "*": "trace" }).addSink({ write }).clock(clock).random(random).sample({ "a.b": 0.5 }),
    );
    const thunk = vi.fn(() => ({ computed: 1 }));
    const bound = vi.fn(() => ({ bound: 1 }));
    const current = vi.spyOn(Scope, "current");
    const resource = vi.spyOn(Scope, "resource");
    const logger = provider.logger("a.b").with(bound);
    expect(logger.enabled("trace")).toBe(true);
    vi.mocked(redactAttributes).mockClear();
    installRegistry();

    logger.trace("m", thunk);
    logger.debug("m", thunk);
    logger.info("m", thunk);

    expect(random).toHaveBeenCalledTimes(3);
    expect(thunk).not.toHaveBeenCalled();
    expect(bound).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    expect(resource).not.toHaveBeenCalled();
    expect(redactAttributes).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(registryReads).toBe(0);

    logger.info("m", thunk);

    expect(thunk).toHaveBeenCalledTimes(1);
    expect(bound).toHaveBeenCalledTimes(1);
    expect(clock).toHaveBeenCalledTimes(1);
    expect(redactAttributes).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(registryReads).toBe(1);
  });

  test("a rate-limited call reads the clock once and runs no thunk, reads no Scope or trace, and redacts nothing", () => {
    const write = vi.fn();
    const clock = vi.fn(() => 0);
    const provider = createLoggerProvider((b) =>
      b
        .addLevels({ "*": "trace" })
        .addSink({ write })
        .clock(clock)
        .rateLimit({ "a.b": { burst: 1, perMinute: 1 } }),
    );
    const thunk = vi.fn(() => ({ computed: 1 }));
    const bound = vi.fn(() => ({ bound: 1 }));
    const logger = provider.logger("a.b").with(bound);
    logger.info("first", thunk);
    expect(write).toHaveBeenCalledTimes(1);
    thunk.mockClear();
    bound.mockClear();
    clock.mockClear();
    vi.mocked(redactAttributes).mockClear();
    const current = vi.spyOn(Scope, "current");
    const resource = vi.spyOn(Scope, "resource");
    installRegistry();

    logger.trace("m", thunk);
    logger.debug("m", thunk);
    logger.info("m", thunk);

    expect(clock).toHaveBeenCalledTimes(3);
    expect(thunk).not.toHaveBeenCalled();
    expect(bound).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    expect(resource).not.toHaveBeenCalled();
    expect(redactAttributes).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
    expect(registryReads).toBe(0);
  });

  test("an enabled call with no sink draws no sample and reads no clock for the rate limit", () => {
    const clock = vi.fn(() => 0);
    const random = vi.fn(() => 0);
    const provider = createLoggerProvider((b) =>
      b
        .addLevels({ "*": "trace" })
        .clock(clock)
        .random(random)
        .sample({ "*": 0.5 })
        .rateLimit({ "*": { burst: 1, perMinute: 1 } }),
    );

    provider.logger("a.b").info("m");

    expect(random).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
  });
});
