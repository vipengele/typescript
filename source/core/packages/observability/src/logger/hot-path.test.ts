import type { Level } from "@vipengele/ts-core-common";
import { Scope } from "@vipengele/ts-core-common/scope";
import { afterEach, describe, expect, test, vi } from "vitest";
import { entryFor } from "./levels";
import { createLogger, type Logger } from "./logger";
import { createLoggerProvider } from "./provider";
import type { EmitSettings, Sink } from "./record";

afterEach(() => {
  vi.restoreAllMocks();
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
  test("never reads the emit settings, runs no thunk and reads no Scope, for any of the six methods", () => {
    const emit = vi.fn((): EmitSettings => {
      throw new Error("a disabled call never reads the emit settings");
    });
    const thunk = vi.fn(() => ({ computed: 1 }));
    const bound = vi.fn(() => ({ bound: 1 }));
    const current = vi.spyOn(Scope, "current");
    const resource = vi.spyOn(Scope, "resource");
    const logger = createLogger("a.b", () => entryFor("off"), emit).with(bound);

    callEveryMethod(logger, thunk);

    expect(emit).not.toHaveBeenCalled();
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

    for (const level of ["trace", "debug", "info"] as const satisfies readonly Level[]) {
      logger[level]("m", thunk);
    }
    logger.warn("m", new Error("boom"), thunk);

    expect(thunk).not.toHaveBeenCalled();
    expect(bound).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();

    logger.error("m", new Error("boom"), thunk);

    expect(thunk).toHaveBeenCalledTimes(1);
    expect(bound).toHaveBeenCalledTimes(1);
    expect(clock).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  test("with every category off, a provider's Logger runs nothing for any of the six methods", () => {
    const write = vi.fn();
    const clock = vi.fn(() => 0);
    const provider = createLoggerProvider((b) => b.addLevels({ "*": "off" }).addSink({ write }).clock(clock));
    const thunk = vi.fn(() => ({ computed: 1 }));
    const bound = vi.fn(() => ({ bound: 1 }));
    const current = vi.spyOn(Scope, "current");
    const resource = vi.spyOn(Scope, "resource");

    callEveryMethod(provider.logger("a.b").with(bound), thunk);

    expect(thunk).not.toHaveBeenCalled();
    expect(bound).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    expect(resource).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});

describe("an enabled call with no sink", () => {
  test("runs no thunk, reads no clock and reads no Scope, for any of the six methods", () => {
    const clock = vi.fn(() => 0);
    const provider = createLoggerProvider((b) => b.addLevels({ "*": "trace" }).clock(clock));
    const thunk = vi.fn(() => ({ computed: 1 }));
    const bound = vi.fn(() => ({ bound: 1 }));
    const current = vi.spyOn(Scope, "current");
    const resource = vi.spyOn(Scope, "resource");
    const logger = provider.logger("a.b").with(bound);

    expect(logger.enabled("trace")).toBe(true);
    callEveryMethod(logger, thunk);

    expect(thunk).not.toHaveBeenCalled();
    expect(bound).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    expect(resource).not.toHaveBeenCalled();
  });
});
