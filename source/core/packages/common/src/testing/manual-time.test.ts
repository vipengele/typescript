import { expect, test, vi } from "vitest";
import { createManualTime } from "./manual-time";

test("createManualTime starts the clock at zero by default", () => {
  const time = createManualTime();

  expect(time.clock()).toBe(0);
  expect(time.pendingSleeps).toBe(0);
});

test("createManualTime starts the clock at the given time", () => {
  expect(createManualTime(1_700_000_000_000).clock()).toBe(1_700_000_000_000);
});

test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
  "createManualTime throws a RangeError for a start time of %s",
  (startMs) => {
    expect(() => createManualTime(startMs)).toThrow(RangeError);
  },
);

test("advance moves the clock by ms with nothing pending", async () => {
  const time = createManualTime(100);

  await time.advance(50);

  expect(time.clock()).toBe(150);
});

test("advance fires sleeps in deadline order and settles at the target", async () => {
  const time = createManualTime(1000);
  const fired: Array<[string, number]> = [];
  const record = (name: string) => () => {
    fired.push([name, time.clock()]);
  };

  const late = time.scheduler.sleep(30).then(record("late"));
  const early = time.scheduler.sleep(10).then(record("early"));
  const middle = time.scheduler.sleep(20).then(record("middle"));
  const beyond = time.scheduler.sleep(100).then(record("beyond"));
  expect(time.pendingSleeps).toBe(4);

  await time.advance(50);
  await Promise.all([late, early, middle]);

  expect(fired).toEqual([
    ["early", 1010],
    ["middle", 1020],
    ["late", 1030],
  ]);
  expect(time.clock()).toBe(1050);
  expect(time.pendingSleeps).toBe(1);

  await time.advance(50);
  await beyond;

  expect(fired.at(-1)).toEqual(["beyond", 1100]);
  expect(time.clock()).toBe(1100);
});

test("advance fires sleeps with the same deadline in registration order", async () => {
  const time = createManualTime();
  const fired: string[] = [];

  void time.scheduler.sleep(10).then(() => fired.push("first"));
  void time.scheduler.sleep(5).then(() => fired.push("earlier"));
  void time.scheduler.sleep(10).then(() => fired.push("second"));
  void time.scheduler.sleep(10).then(() => fired.push("third"));

  await time.advance(10);

  expect(fired).toEqual(["earlier", "first", "second", "third"]);
});

test("a continuation that sleeps again within the window fires in the same advance, measured from its deadline", async () => {
  const time = createManualTime();
  const seen: number[] = [];

  const chain = (async () => {
    await time.scheduler.sleep(10);
    seen.push(time.clock());
    await time.scheduler.sleep(15);
    seen.push(time.clock());
    await time.scheduler.sleep(15);
    seen.push(time.clock());
  })();

  await time.advance(30);

  expect(seen).toEqual([10, 25]);
  expect(time.clock()).toBe(30);
  expect(time.pendingSleeps).toBe(1);

  await time.advance(10);
  await chain;

  expect(seen).toEqual([10, 25, 40]);
});

test("a sleep(0) registered mid-window fires in the same advance at the current deadline", async () => {
  const time = createManualTime();
  const seen: number[] = [];

  void (async () => {
    await time.scheduler.sleep(10);
    await time.scheduler.sleep(0);
    seen.push(time.clock());
  })();

  await time.advance(20);

  expect(seen).toEqual([10]);
  expect(time.pendingSleeps).toBe(0);
});

test("a sleep at exactly the target deadline fires", async () => {
  const time = createManualTime();
  let fired = false;

  void time.scheduler.sleep(10).then(() => {
    fired = true;
  });

  await time.advance(9);
  expect(fired).toBe(false);

  await time.advance(1);
  expect(fired).toBe(true);
});

test("pendingSleeps inside a continuation excludes the sleep that fired", async () => {
  const time = createManualTime();
  const counts: number[] = [];

  void time.scheduler.sleep(10).then(() => counts.push(time.pendingSleeps));
  void time.scheduler.sleep(20);

  await time.advance(10);

  expect(counts).toEqual([1]);
});

test("sleep rejects with the reason of an already-aborted signal without enqueuing", async () => {
  const time = createManualTime();
  const reason = new Error("stop");

  await expect(time.scheduler.sleep(10, AbortSignal.abort(reason))).rejects.toBe(reason);
  expect(time.pendingSleeps).toBe(0);
});

test("an abort while pending removes the sleep and rejects with the signal reason", async () => {
  const time = createManualTime();
  const controller = new AbortController();
  const reason = new Error("stop");
  let kept = false;

  const aborted = time.scheduler.sleep(10, controller.signal);
  const assertion = expect(aborted).rejects.toBe(reason);
  void time.scheduler.sleep(10).then(() => {
    kept = true;
  });

  controller.abort(reason);

  await assertion;
  expect(time.pendingSleeps).toBe(1);

  await time.advance(10);
  expect(kept).toBe(true);
});

test("a sleep aborted during a hop rejects with the signal reason even when its deadline is due", async () => {
  const time = createManualTime();
  const controller = new AbortController();
  const reason = new Error("stop");

  void time.scheduler.sleep(5).then(() => controller.abort(reason));
  const aborted = time.scheduler.sleep(10, controller.signal);
  const assertion = expect(aborted).rejects.toBe(reason);

  await time.advance(10);

  await assertion;
  expect(time.pendingSleeps).toBe(0);
  expect(time.clock()).toBe(10);
});

test("a sleep with a live signal resolves and removes its abort listener", async () => {
  const time = createManualTime();
  const controller = new AbortController();
  const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

  const sleeping = time.scheduler.sleep(10, controller.signal);
  await time.advance(10);

  await expect(sleeping).resolves.toBeUndefined();
  expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
});

test("an abort after the sleep has fired is a no-op", async () => {
  const time = createManualTime();
  const controller = new AbortController();
  void time.scheduler.sleep(20);

  const sleeping = time.scheduler.sleep(10, controller.signal);
  await time.advance(10);
  await sleeping;
  controller.abort(new Error("late"));

  expect(time.pendingSleeps).toBe(1);
});

test("advance rejects with a TypeError while another advance is in flight", async () => {
  const time = createManualTime();
  void time.scheduler.sleep(10);

  const first = time.advance(10);
  await expect(time.advance(5)).rejects.toBeInstanceOf(TypeError);
  await first;

  expect(time.clock()).toBe(10);
  await expect(time.advance(5)).resolves.toBeUndefined();
});

test("advance called from a fired continuation rejects with a TypeError", async () => {
  const time = createManualTime();
  let nested: Promise<void> | undefined;

  void time.scheduler.sleep(10).then(() => {
    nested = time.advance(5);
    nested.catch(() => {});
  });

  await time.advance(10);

  await expect(nested).rejects.toBeInstanceOf(TypeError);
  expect(time.clock()).toBe(10);
});

test.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
  "sleep rejects %s with a RangeError without enqueuing",
  async (ms) => {
    const time = createManualTime();

    await expect(time.scheduler.sleep(ms)).rejects.toBeInstanceOf(RangeError);
    expect(time.pendingSleeps).toBe(0);
  },
);

test.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
  "advance rejects %s with a RangeError and leaves the clock alone",
  async (ms) => {
    const time = createManualTime(5);

    const advancing = time.advance(ms);

    await expect(advancing).rejects.toBeInstanceOf(RangeError);
    expect(time.clock()).toBe(5);
    await expect(time.advance(1)).resolves.toBeUndefined();
  },
);
