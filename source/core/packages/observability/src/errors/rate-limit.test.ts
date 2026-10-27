import { createManualTime } from "@vipengele/ts-core-common/testing";
import { describe, expect, it } from "vitest";
import { createRateLimiter, DEFAULT_RATE_LIMIT } from "./rate-limit";
import { createReporter } from "./reporter";
import { createTestTransport } from "./transports/test-transport";

/** How many of `count` takes at `time` the limiter passes. */
function takeMany(limiter: { take(time: number): boolean }, count: number, time: number): number {
  let taken = 0;
  for (let index = 0; index < count; index += 1) {
    if (limiter.take(time)) {
      taken += 1;
    }
  }
  return taken;
}

describe("DEFAULT_RATE_LIMIT", () => {
  it("is a frozen burst of 60 refilled at 60 per minute", () => {
    expect(DEFAULT_RATE_LIMIT).toEqual({ burst: 60, perMinute: 60 });
    expect(Object.isFrozen(DEFAULT_RATE_LIMIT)).toBe(true);
  });
});

describe("createRateLimiter", () => {
  it("starts full, passes a burst's worth of takes at one time, and refuses the next", () => {
    const limiter = createRateLimiter({ burst: 3, perMinute: 60 });

    expect(takeMany(limiter, 3, 1000)).toBe(3);
    expect(limiter.take(1000)).toBe(false);
  });

  it("refills perMinute tokens a minute of the times it is handed", () => {
    const limiter = createRateLimiter({ burst: 3, perMinute: 6 });

    takeMany(limiter, 3, 0);

    expect(limiter.take(9_999)).toBe(false);
    expect(limiter.take(10_000)).toBe(true);
    expect(limiter.take(10_000)).toBe(false);
  });

  it("carries a fraction of a token over to the next refill", () => {
    const limiter = createRateLimiter({ burst: 1, perMinute: 60 });

    limiter.take(0);

    expect(limiter.take(500)).toBe(false);
    expect(limiter.take(999)).toBe(false);
    expect(limiter.take(1000)).toBe(true);
  });

  it("refills no more than burst, however long it has been", () => {
    const limiter = createRateLimiter({ burst: 2, perMinute: 60 });

    takeMany(limiter, 2, 0);

    expect(takeMany(limiter, 5, 3_600_000)).toBe(2);
  });

  it("refills nothing for a time earlier than the latest one, and never refills that interval twice", () => {
    const limiter = createRateLimiter({ burst: 1, perMinute: 60 });

    limiter.take(10_000);

    expect(limiter.take(5_000)).toBe(false);
    expect(limiter.take(10_500)).toBe(false);
    expect(limiter.take(11_000)).toBe(true);
  });

  it("keeps a bucket per limiter", () => {
    const first = createRateLimiter({ burst: 1, perMinute: 1 });
    const second = createRateLimiter({ burst: 1, perMinute: 1 });

    first.take(0);

    expect(second.take(0)).toBe(true);
  });
});

describe("the rate limit in a reporter", () => {
  function aLimitedReporter(configure: Parameters<typeof createReporter>[0] = (b) => b) {
    const time = createManualTime(1_000_000);
    const transport = createTestTransport();
    const reporter = createReporter((b) => configure(b.transport(transport).clock(time.clock)));
    return { time, transport, reporter };
  }

  function captureMany(reporter: ReturnType<typeof createReporter>, count: number, prefix: string): void {
    for (let index = 0; index < count; index += 1) {
      reporter.captureMessage(`${prefix} ${index}`);
    }
  }

  it("sends a burst of 60 distinct events, drops the 61st, and still returns its id", () => {
    const { transport, reporter } = aLimitedReporter();

    captureMany(reporter, 60, "event");

    expect(reporter.captureMessage("one too many")).toMatch(/^[0-9a-f]{32}$/);
    expect(transport.events).toHaveLength(60);
  });

  it("refills from the clock's time as it advances", async () => {
    const { time, transport, reporter } = aLimitedReporter((b) => b.rateLimit({ burst: 2, perMinute: 2 }));

    captureMany(reporter, 3, "first");
    await time.advance(15_000);
    reporter.captureMessage("too early");
    await time.advance(15_000);
    reporter.captureMessage("refilled");
    reporter.captureMessage("empty again");

    expect(transport.events.map((event) => event.message)).toEqual(["first 0", "first 1", "refilled"]);
  });

  it("refills one token a second by default", async () => {
    const { time, transport, reporter } = aLimitedReporter();

    captureMany(reporter, 61, "flood");
    await time.advance(2_000);
    captureMany(reporter, 3, "later");

    expect(transport.events.slice(60).map((event) => event.message)).toEqual(["later 0", "later 1"]);
  });

  it("sends every event with rateLimit(false)", () => {
    const { transport, reporter } = aLimitedReporter((b) => b.rateLimit(false));

    captureMany(reporter, 100, "event");

    expect(transport.events).toHaveLength(100);
  });

  it("keeps a bucket per reporter", () => {
    const first = aLimitedReporter((b) => b.rateLimit({ burst: 1, perMinute: 1 }));
    const second = aLimitedReporter((b) => b.rateLimit({ burst: 1, perMinute: 1 }));

    first.reporter.captureMessage("first");
    second.reporter.captureMessage("second");

    expect(first.transport.events).toHaveLength(1);
    expect(second.transport.events).toHaveLength(1);
  });
});
