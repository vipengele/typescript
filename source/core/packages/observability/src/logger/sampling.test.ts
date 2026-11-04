import type { Level } from "@vipengele/ts-core-common";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CONSOLE_HANDLE_CATEGORY } from "./console-handle";
import { DROPPED_ATTRIBUTE } from "./emit";
import { entryFor } from "./levels";
import { createLogger } from "./logger";
import { Logging, setWarnTarget } from "./logging";
import { flattenPolicyLayers, freezePolicyLayer, LogPolicy } from "./policy";
import { createLoggerProvider } from "./provider";
import type { EmitSettings } from "./record";
import { createTestSink } from "./test-sink";

const LEVELS_SLOT = Symbol.for("vipengele.logger.levels");
const PROVIDER_SLOT = Symbol.for("vipengele.logger.provider.v1");
const registry = globalThis as unknown as Record<symbol, unknown>;

afterEach(() => {
  vi.restoreAllMocks();
  setWarnTarget(undefined);
  delete registry[LEVELS_SLOT];
  delete registry[PROVIDER_SLOT];
});

/** A random source returning `draws` in order. */
function drawing(...draws: number[]): () => number {
  return () => draws.shift() as number;
}

/** A clock reading whatever `time.now` holds. */
function manualClock(start = 0): { now: number; readonly clock: () => number } {
  const time = {
    now: start,
    clock: () => time.now,
  };
  return time;
}

const ONE_PER_SECOND = { burst: 1, perMinute: 60 };

describe("sampling", () => {
  test("a record is kept when the draw is below the rate and dropped otherwise", () => {
    const sink = createTestSink();
    const provider = createLoggerProvider((b) =>
      b
        .addLevels({ "*": "trace" })
        .addSink(sink)
        .random(drawing(0.4, 0.5, 0.6, 0))
        .sample({ app: 0.5 }),
    );
    const logger = provider.logger("app.db");

    logger.debug("one");
    logger.debug("two");
    logger.info("three");
    logger.trace("four");

    expect(sink.records.map((record) => record.message)).toEqual(["one", "four"]);
  });

  test("warn and above pass a rule without upTo, and draw nothing", () => {
    const sink = createTestSink();
    const random = vi.fn(() => 0.99);
    const provider = createLoggerProvider((b) => b.addLevels({ "*": "trace" }).addSink(sink).random(random).sample({ "*": 0 }));
    const logger = provider.logger("app");

    logger.info("dropped");
    logger.warn("w");
    logger.error("e");
    logger.fatal("f");

    expect(sink.records.map((record) => record.level)).toEqual(["warn", "error", "fatal"]);
    expect(random).toHaveBeenCalledOnce();
  });

  test("upTo extends a rule to the levels up to it, and leaves the ones above it alone", () => {
    const sink = createTestSink();
    const provider = createLoggerProvider((b) =>
      b
        .addLevels({ "*": "trace" })
        .addSink(sink)
        .random(() => 0.5)
        .sample({ app: { rate: 0, upTo: "error" } }),
    );
    const logger = provider.logger("app");

    for (const level of ["trace", "debug", "info", "warn", "error", "fatal"] as const satisfies readonly Level[]) {
      logger[level]("m");
    }

    expect(sink.records.map((record) => record.level)).toEqual(["fatal"]);
  });

  test("a call through createLogger with a policy and no random source draws from Math.random", () => {
    const sink = createTestSink();
    const random = vi.spyOn(Math, "random").mockReturnValueOnce(0.9).mockReturnValueOnce(0.1);
    const settings: EmitSettings = {
      sinks: [{ sink, processors: [] }],
      processors: [],
      clock: () => 0,
      redaction: null,
      policy: new LogPolicy(flattenPolicyLayers([freezePolicyLayer({ sample: { a: 0.5 } })])),
      resource: () => ({}) as never,
      onSinkError: () => {},
    };
    const logger = createLogger(
      "a",
      () => entryFor("trace"),
      () => settings,
    );

    logger.info("dropped");
    logger.info("kept");

    expect(random).toHaveBeenCalledTimes(2);
    expect(sink.records.map((record) => record.message)).toEqual(["kept"]);
  });
});

describe("rate limits", () => {
  test("a rule's bucket is shared by every category it governs", () => {
    const sink = createTestSink();
    const provider = createLoggerProvider((b) =>
      b
        .addLevels({ "*": "trace" })
        .addSink(sink)
        .clock(() => 0)
        .rateLimit({ app: { burst: 2, perMinute: 1 } }),
    );

    provider.logger("app.a").info("a");
    provider.logger("app.b").info("b");
    provider.logger("app.c").info("c");
    provider.logger("other").info("other");

    expect(sink.records.map((record) => record.message)).toEqual(["a", "b", "other"]);
  });

  test("warn and above pass a rule without upTo, and upTo extends it", () => {
    const sink = createTestSink();
    const provider = createLoggerProvider((b) =>
      b
        .addLevels({ "*": "trace" })
        .addSink(sink)
        .clock(() => 0)
        .rateLimit({ app: { burst: 1, perMinute: 1 }, strict: { burst: 1, perMinute: 1, upTo: "fatal" } }),
    );

    for (const category of ["app", "strict"]) {
      const logger = provider.logger(category);
      logger.info("i");
      logger.warn("w1");
      logger.warn("w2");
    }

    expect(sink.records.map((record) => `${record.category}:${record.message}`)).toEqual(["app:i", "app:w1", "app:w2", "strict:i"]);
  });

  test("the next admitted record carries the rule's dropped count, over a caller's attribute, and the count resets once it is built", () => {
    const sink = createTestSink();
    const time = manualClock();
    const provider = createLoggerProvider((b) =>
      b.addLevels({ "*": "trace" }).addSink(sink).clock(time.clock).rateLimit({ app: ONE_PER_SECOND }),
    );

    provider.logger("app.a").info("first");
    provider.logger("app.a").info("dropped");
    provider.logger("app.a").debug("dropped");
    provider.logger("app.b").trace("dropped");
    time.now = 1_000;
    provider.logger("app.b").info("second", { [DROPPED_ATTRIBUTE]: "caller", k: 1 });
    time.now = 2_000;
    provider.logger("app.a").info("third");

    expect(sink.records.map((record) => [record.category, record.message, record.attributes])).toEqual([
      ["app.a", "first", {}],
      ["app.b", "second", { [DROPPED_ATTRIBUTE]: 3, k: 1 }],
      ["app.a", "third", {}],
    ]);
  });

  test("sampling runs before the rate limit, so a sampled-out record takes no token and is not counted", () => {
    const sink = createTestSink();
    const provider = createLoggerProvider((b) =>
      b
        .addLevels({ "*": "trace" })
        .addSink(sink)
        .clock(() => 0)
        .random(drawing(0.9, 0.9, 0.1, 0.1))
        .sample({ app: 0.5 })
        .rateLimit({ app: { burst: 1, perMinute: 1 } }),
    );
    const logger = provider.logger("app");

    logger.info("sampled out");
    logger.info("sampled out");
    logger.info("admitted");
    logger.info("limited");

    expect(sink.records.map((record) => [record.message, record.attributes])).toEqual([["admitted", {}]]);
  });

  test("a throwing clock drops the record silently, takes no token and is not counted", () => {
    const sink = createTestSink();
    const onSinkError = vi.fn();
    let failing = true;
    const clock = (): number => {
      if (failing) {
        throw new Error("clock failed");
      }
      return 0;
    };
    const provider = createLoggerProvider(
      (b) =>
        b
          .addLevels({ "*": "trace" })
          .addSink(sink)
          .clock(clock)
          .rateLimit({ app: { burst: 1, perMinute: 1 } }),
      { onSinkError },
    );
    const logger = provider.logger("app");

    expect(() => logger.info("lost")).not.toThrow();
    failing = false;
    logger.info("kept");

    expect(sink.records.map((record) => [record.message, record.attributes])).toEqual([["kept", {}]]);
    expect(onSinkError).not.toHaveBeenCalled();
  });

  test("the record's time is the one reading the rate limit took", () => {
    const sink = createTestSink();
    let reading = 0;
    const clock = vi.fn(() => {
      reading += 1_000;
      return reading;
    });
    const provider = createLoggerProvider((b) =>
      b.addLevels({ "*": "trace" }).addSink(sink).clock(clock).rateLimit({ app: ONE_PER_SECOND }),
    );
    const logger = provider.logger("app");

    logger.info("one");
    logger.info("two");

    expect(clock).toHaveBeenCalledTimes(2);
    expect(sink.records.map((record) => record.time)).toEqual([1_000, 2_000]);
  });

  test("a record no rate limit governs reads the clock once, for its own time", () => {
    const sink = createTestSink();
    const clock = vi.fn(() => 7);
    const provider = createLoggerProvider((b) =>
      b.addLevels({ "*": "trace" }).addSink(sink).clock(clock).rateLimit({ app: ONE_PER_SECOND }),
    );

    provider.logger("other").info("m");
    provider.logger("app").warn("m");

    expect(clock).toHaveBeenCalledTimes(2);
    expect(sink.records.map((record) => record.time)).toEqual([7, 7]);
  });

  test("a rule's bucket and dropped count survive Logging.override", () => {
    const sink = createTestSink();
    const time = manualClock();
    Logging.configure((b) => b.addLevels({ "*": "trace" }).addSink(sink).clock(time.clock).rateLimit({ app: ONE_PER_SECOND }));
    const logger = Logging.logger("app");

    logger.info("first");
    logger.info("dropped");
    Logging.override("other", "debug");
    logger.info("dropped");
    time.now = 1_000;
    Logging.override("other", null);
    logger.info("second");

    expect(sink.records.map((record) => [record.message, record.attributes])).toEqual([
      ["first", {}],
      ["second", { [DROPPED_ATTRIBUTE]: 2 }],
    ]);
  });
});

describe("the console handle's confirmation", () => {
  test("is neither sampled nor rate-limited", () => {
    const sink = createTestSink();
    const name = "__vipengeleSamplingTestHandle";
    const random = vi.fn(() => 0.99);
    const provider = createLoggerProvider((b) =>
      b
        .addSink(sink)
        .clock(() => 0)
        .random(random)
        .sample({ "*": 0 })
        .rateLimit({ "*": { burst: 1, perMinute: 1 } }),
    );
    const uninstall = provider.installConsole(name);
    try {
      const handle = (globalThis as unknown as Record<string, (spec?: string) => void>)[name] as (spec?: string) => void;
      handle("app:debug");
      handle();
      handle();
    } finally {
      uninstall();
    }

    expect(sink.find({ category: CONSOLE_HANDLE_CATEGORY })).toHaveLength(3);
    expect(random).not.toHaveBeenCalled();
  });
});
