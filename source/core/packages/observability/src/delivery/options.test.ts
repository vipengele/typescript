import { describe, expect, it } from "vitest";
import { deliveryOptionsProblem } from "./options";

const URL_OK = "https://collector.example/v1/logs";

describe("deliveryOptionsProblem", () => {
  it("finds no problem with an http or https url and no limits", () => {
    expect(deliveryOptionsProblem(URL_OK)).toBeUndefined();
    expect(deliveryOptionsProblem("http://localhost:4318/v1/logs", {})).toBeUndefined();
  });

  it("finds no problem with valid limits", () => {
    const limits = { maxQueueSize: 1, maxBatchSize: 2, maxAttempts: 3, scheduleDelayMs: 0.5, attemptTimeoutMs: 10, flushTimeoutMs: 20 };

    expect(deliveryOptionsProblem(URL_OK, limits)).toBeUndefined();
  });

  it.each([
    [undefined, "url to be an absolute http or https URL, got undefined"],
    ["/v1/logs", "url to be an absolute http or https URL, got /v1/logs"],
    ["collector", "url to be an absolute http or https URL, got collector"],
    ["ftp://collector.example/logs", "url to use http or https, got ftp:"],
  ])("describes the url %s", (url, message) => {
    expect(deliveryOptionsProblem(url)).toBe(message);
  });

  it.each([
    [{ maxQueueSize: 0 }, "maxQueueSize to be an integer of at least 1, got 0"],
    [{ maxBatchSize: 1.5 }, "maxBatchSize to be an integer of at least 1, got 1.5"],
    [{ maxAttempts: -1 }, "maxAttempts to be an integer of at least 1, got -1"],
    [{ scheduleDelayMs: 0 }, "scheduleDelayMs to be positive and finite, got 0"],
    [{ attemptTimeoutMs: Number.NaN }, "attemptTimeoutMs to be positive and finite, got NaN"],
    [{ flushTimeoutMs: Number.POSITIVE_INFINITY }, "flushTimeoutMs to be positive and finite, got Infinity"],
  ])("names the invalid limit in %j", (limits, message) => {
    expect(deliveryOptionsProblem(URL_OK, limits)).toBe(message);
  });

  it("reports the url before the limits, and the integer limits before the durations", () => {
    expect(deliveryOptionsProblem("/v1/logs", { maxQueueSize: 0 })).toMatch(/url/);
    expect(deliveryOptionsProblem(URL_OK, { scheduleDelayMs: 0, maxQueueSize: 0 })).toMatch(/maxQueueSize/);
  });
});
