import { describe, expect, it } from "vitest";
import { createTokenBucket } from "./token-bucket";

describe("createTokenBucket", () => {
  it("starts full, passes a burst's worth of takes at one time, and refuses the next", () => {
    const bucket = createTokenBucket({ burst: 3, perMinute: 60 });

    expect([bucket.take(1000), bucket.take(1000), bucket.take(1000)]).toEqual([true, true, true]);
    expect(bucket.take(1000)).toBe(false);
  });

  it("refills perMinute tokens a minute and carries a fraction over", () => {
    const bucket = createTokenBucket({ burst: 3, perMinute: 6 });
    bucket.take(0);
    bucket.take(0);
    bucket.take(0);

    expect(bucket.take(9_999)).toBe(false);
    expect(bucket.take(10_000)).toBe(true);
    expect(bucket.take(10_000)).toBe(false);
  });

  it("never holds more than burst tokens", () => {
    const bucket = createTokenBucket({ burst: 2, perMinute: 60 });

    expect([bucket.take(0), bucket.take(3_600_000), bucket.take(3_600_000)]).toEqual([true, true, true]);
    expect(bucket.take(3_600_000)).toBe(false);
  });

  it("neither drains nor double-refills when the clock steps back", () => {
    const bucket = createTokenBucket({ burst: 2, perMinute: 60 });
    bucket.take(60_000);
    bucket.take(60_000);

    expect(bucket.take(0)).toBe(false);
    expect(bucket.take(60_500)).toBe(false);
    expect(bucket.take(61_000)).toBe(true);
    expect(bucket.take(61_000)).toBe(false);
  });
});
