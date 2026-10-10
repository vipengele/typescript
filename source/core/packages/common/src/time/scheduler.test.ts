import { expect, test, vi } from "vitest";
import { systemScheduler } from "./scheduler";

test("systemScheduler.sleep resolves after the delay", async () => {
  const start = performance.now();

  await systemScheduler.sleep(20);

  expect(performance.now() - start).toBeGreaterThanOrEqual(15);
});

test("systemScheduler.sleep with a live signal resolves after the delay", async () => {
  const controller = new AbortController();

  await expect(systemScheduler.sleep(1, controller.signal)).resolves.toBeUndefined();
});

test("systemScheduler.sleep rejects with the reason of an already-aborted signal without a timer", async () => {
  const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
  const reason = new Error("stop");

  try {
    await expect(systemScheduler.sleep(1000, AbortSignal.abort(reason))).rejects.toBe(reason);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  } finally {
    setTimeoutSpy.mockRestore();
  }
});

test("systemScheduler.sleep rejects with the signal reason and clears the timer when aborted during the sleep", async () => {
  const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
  const controller = new AbortController();
  const reason = new Error("stop");

  try {
    const pending = systemScheduler.sleep(10_000, controller.signal);
    const assertion = expect(pending).rejects.toBe(reason);

    controller.abort(reason);

    await assertion;
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  } finally {
    clearTimeoutSpy.mockRestore();
  }
});

test("systemScheduler.sleep removes its abort listener when the sleep resolves", async () => {
  const controller = new AbortController();
  const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

  await systemScheduler.sleep(1, controller.signal);

  expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
});

test("systemScheduler.sleep ignores an abort after the sleep has fired", async () => {
  const controller = new AbortController();
  const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

  try {
    await systemScheduler.sleep(1, controller.signal);
    controller.abort(new Error("late"));

    expect(clearTimeoutSpy).not.toHaveBeenCalled();
  } finally {
    clearTimeoutSpy.mockRestore();
  }
});

test.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
  "systemScheduler.sleep rejects %s with a RangeError",
  async (ms) => {
    await expect(systemScheduler.sleep(ms)).rejects.toBeInstanceOf(RangeError);
  },
);
