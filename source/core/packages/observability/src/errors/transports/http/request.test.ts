import { createManualTime, type ManualTime } from "@vipengele/ts-core-common/testing";
import type { Resource } from "@vipengele/ts-core-common/scope";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ErrorEvent } from "../../event";
import { type HttpTransportOptions, resolveOptions } from "./options";
import type { Batch } from "./queue";
import { type RequestResult, sendBatch } from "./request";

const url = "https://errors.example.com/ingest";

function anEvent(message = "m"): ErrorEvent {
  return {
    id: "0".repeat(32),
    time: 0,
    level: "error",
    message,
    mechanism: { handled: true, source: "capture" },
    attributes: {},
  };
}

function aResource(): Resource {
  return Object.freeze({
    "service.name": "shop",
    "service.version": "1.0.0",
    "service.dist": undefined,
    "deployment.environment.name": "production",
    "process.runtime.name": "nodejs",
    "process.runtime.version": "24.0.0",
    "os.type": "linux",
    "os.version": "6.1",
    "browser.name": undefined,
    "browser.version": undefined,
    "device.type": undefined,
  });
}

function aBatch(...events: ErrorEvent[]): Batch {
  return { events: events.length === 0 ? [anEvent()] : events, resource: aResource() };
}

interface Call {
  readonly at: number;
  readonly url: string;
  readonly init: RequestInit;
}

/** A response, a status for one with no body, or a value the fake throws synchronously (`throw`) or rejects with (`reject`). */
type Step = number | Response | { readonly throw: unknown } | { readonly reject: unknown };

/**
 * A fake `fetch` answering each call with the next step; the last step repeats. Records the
 * virtual time of every call.
 */
function fakeFetch(time: ManualTime, ...steps: Step[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fake = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ at: time.clock(), url: String(input), init: init as RequestInit });
    const step = steps[Math.min(calls.length, steps.length) - 1] as Step;
    if (typeof step === "number") {
      return Promise.resolve(new Response(null, { status: step }));
    }
    if (step instanceof Response) {
      return Promise.resolve(step);
    }
    if ("throw" in step) {
      throw step.throw;
    }
    return Promise.reject(step.reject);
  };
  return { fetch: fake as typeof fetch, calls };
}

function settings(time: ManualTime, options: Partial<HttpTransportOptions> = {}) {
  return resolveOptions({ url, clock: time.clock, scheduler: time.scheduler, random: () => 0.5, ...options });
}

function hop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Moves virtual time forward until `pending` settles, firing every backoff and Retry-After wait. */
async function drive(time: ManualTime, pending: Promise<RequestResult>): Promise<RequestResult> {
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  while (!settled) {
    await hop();
    await time.advance(60_000);
  }
  return pending;
}

function retryAfter(status: number, value: string): Response {
  return new Response(null, { status, headers: { "Retry-After": value } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendBatch status classes", () => {
  it.each([200, 202, 204])("delivers on a %s with one request", async (status) => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, status);
    const batch = aBatch();

    const result = await drive(time, sendBatch(batch, settings(time, { fetch })));

    expect(result).toEqual([{ events: batch.events, outcome: "delivered" }]);
    expect(calls).toHaveLength(1);
  });

  it.each([301, 302, 304, 400, 401, 404, 413])("rejects a %s at once, without a retry", async (status) => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, status, 200);
    const batch = aBatch();

    const result = await drive(time, sendBatch(batch, settings(time, { fetch })));

    expect(result).toEqual([{ events: batch.events, outcome: "rejected" }]);
    expect(calls).toHaveLength(1);
  });

  it.each([408, 429, 500, 502, 503, 599])("retries a %s and delivers on the next success", async (status) => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, status, 200);
    const batch = aBatch();

    const result = await drive(time, sendBatch(batch, settings(time, { fetch })));

    expect(result).toEqual([{ events: batch.events, outcome: "delivered" }]);
    expect(calls).toHaveLength(2);
  });

  it("settles retries-exhausted once maxAttempts retryable responses arrive", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 503);
    const batch = aBatch();

    const result = await drive(time, sendBatch(batch, settings(time, { fetch, maxAttempts: 3 })));

    expect(result).toEqual([{ events: batch.events, outcome: "retries-exhausted" }]);
    expect(calls).toHaveLength(3);
  });

  it("settles retries-exhausted after a single failed attempt when maxAttempts is 1", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 429);

    const result = await drive(time, sendBatch(aBatch(), settings(time, { fetch, maxAttempts: 1 })));

    expect(result[0]?.outcome).toBe("retries-exhausted");
    expect(calls).toHaveLength(1);
  });
});

describe("sendBatch waits", () => {
  it("waits a full-jitter exponential backoff, capped at maxDelayMs, without a Retry-After", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 503, 503, 503, 503, 200);

    const result = await drive(time, sendBatch(aBatch(), settings(time, { fetch, maxDelayMs: 3000 })));

    expect(result[0]?.outcome).toBe("delivered");
    // random 0.5 of 1000, 2000, 3000 (4000 capped), 3000 (8000 capped).
    expect(calls.map((call) => call.at)).toEqual([0, 500, 1500, 3000, 4500]);
  });

  it("waits a Retry-After given in seconds", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, retryAfter(429, "7"), 200);

    await drive(time, sendBatch(aBatch(), settings(time, { fetch })));

    expect(calls.map((call) => call.at)).toEqual([0, 7000]);
  });

  it("waits until a Retry-After given as an HTTP-date, read against the clock", async () => {
    const start = Date.UTC(2026, 9, 30, 12, 0, 0);
    const time = createManualTime(start);
    const { fetch, calls } = fakeFetch(time, retryAfter(503, new Date(start + 12_000).toUTCString()), 200);

    await drive(time, sendBatch(aBatch(), settings(time, { fetch })));

    expect(calls.map((call) => call.at - start)).toEqual([0, 12_000]);
  });

  it("caps a Retry-After at maxDelayMs", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, retryAfter(429, "120"), 200);

    await drive(time, sendBatch(aBatch(), settings(time, { fetch, maxDelayMs: 5000 })));

    expect(calls.map((call) => call.at)).toEqual([0, 5000]);
  });

  it("falls back to the backoff for an unreadable Retry-After", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, retryAfter(503, "soon"), 200);

    await drive(time, sendBatch(aBatch(), settings(time, { fetch })));

    expect(calls.map((call) => call.at)).toEqual([0, 500]);
  });
});

describe("sendBatch failed attempts", () => {
  it("retries a fetch that rejects, as a network error does", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, { reject: new TypeError("Failed to fetch") }, 200);

    const result = await drive(time, sendBatch(aBatch(), settings(time, { fetch })));

    expect(result[0]?.outcome).toBe("delivered");
    expect(calls.map((call) => call.at)).toEqual([0, 500]);
  });

  it("retries a fetch that throws synchronously", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, { throw: new TypeError("bad init") }, 200);

    const result = await drive(time, sendBatch(aBatch(), settings(time, { fetch })));

    expect(result[0]?.outcome).toBe("delivered");
    expect(calls).toHaveLength(2);
  });

  it("settles retries-exhausted when every attempt is a network error", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, { reject: new TypeError("Failed to fetch") });

    const result = await drive(time, sendBatch(aBatch(), settings(time, { fetch, maxAttempts: 2 })));

    expect(result[0]?.outcome).toBe("retries-exhausted");
    expect(calls).toHaveLength(2);
  });

  it("counts a throwing headers function as a failed attempt and retries it", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 200);
    let attempts = 0;
    const headers = () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("no token yet");
      }
      return { Authorization: "Bearer t" };
    };

    const result = await drive(time, sendBatch(aBatch(), settings(time, { fetch, headers })));

    expect(result[0]?.outcome).toBe("delivered");
    expect(attempts).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.at).toBe(500);
    expect(new Headers(calls[0]?.init.headers).get("Authorization")).toBe("Bearer t");
  });

  it("counts a rejecting headers function as a failed attempt and retries it", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 200);
    let attempts = 0;
    const headers = async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error("token refresh failed");
      }
      return { Authorization: "Bearer fresh" };
    };

    const result = await drive(time, sendBatch(aBatch(), settings(time, { fetch, headers })));

    expect(result[0]?.outcome).toBe("delivered");
    expect(attempts).toBe(3);
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0]?.init.headers).get("Authorization")).toBe("Bearer fresh");
  });

  it("settles retries-exhausted when the headers function always throws", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 200);
    const headers = () => {
      throw new Error("no token");
    };

    const result = await drive(time, sendBatch(aBatch(), settings(time, { fetch, headers, maxAttempts: 2 })));

    expect(result[0]?.outcome).toBe("retries-exhausted");
    expect(calls).toHaveLength(0);
  });

  it("resolves the headers function again for every attempt", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 503, 200);
    let issued = 0;
    const headers = () => {
      issued += 1;
      return { "X-Attempt": String(issued) };
    };

    await drive(time, sendBatch(aBatch(), settings(time, { fetch, headers })));

    expect(calls.map((call) => new Headers(call.init.headers).get("X-Attempt"))).toEqual(["1", "2"]);
  });
});

describe("sendBatch request", () => {
  it("POSTs the default envelope, holding only the Resource's defined keys, as application/json", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 200);
    const batch = aBatch(anEvent("a"), anEvent("b"));
    const signal = new AbortController().signal;

    await drive(time, sendBatch(batch, settings(time, { fetch, headers: { "X-Key": "k" } }), signal));

    const [call] = calls;
    expect(call?.url).toBe(url);
    expect(call?.init.method).toBe("POST");
    expect(call?.init.signal).toBe(signal);
    const headers = new Headers(call?.init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Key")).toBe("k");
    expect(JSON.parse(call?.init.body as string)).toEqual({
      resource: {
        "service.name": "shop",
        "service.version": "1.0.0",
        "deployment.environment.name": "production",
        "process.runtime.name": "nodejs",
        "process.runtime.version": "24.0.0",
        "os.type": "linux",
        "os.version": "6.1",
      },
      events: batch.events,
    });
  });

  it("sends a custom serializer's body with the configured contentType, which wins over a headers entry", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 200);
    const serialize = vi.fn((events: readonly ErrorEvent[]) => events.map((event) => event.message).join("\n"));
    const batch = aBatch(anEvent("a"), anEvent("b"));

    await drive(
      time,
      sendBatch(
        batch,
        settings(time, { fetch, serialize, contentType: "application/x-ndjson", headers: () => ({ "content-type": "text/plain" }) }),
      ),
    );

    expect(serialize).toHaveBeenCalledWith(batch.events, batch.resource);
    expect(calls[0]?.init.body).toBe("a\nb");
    expect(new Headers(calls[0]?.init.headers).get("Content-Type")).toBe("application/x-ndjson");
  });

  it("serializes once per batch, not once per attempt", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 500, 500, 200);
    const serialize = vi.fn(() => "body");

    await drive(time, sendBatch(aBatch(), settings(time, { fetch, serialize })));

    expect(serialize).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(3);
  });

  it("reads globalThis.fetch at send time when no fetch is given", async () => {
    const time = createManualTime();
    const options = settings(time);
    const { fetch, calls } = fakeFetch(time, 200);
    vi.stubGlobal("fetch", fetch);

    const result = await drive(time, sendBatch(aBatch(), options));

    expect(result[0]?.outcome).toBe("delivered");
    expect(calls).toHaveLength(1);
  });
});

describe("sendBatch unsendable", () => {
  it("drops the batch as unsendable when no fetch is given and globalThis has none", async () => {
    const time = createManualTime();
    vi.stubGlobal("fetch", undefined);
    const batch = aBatch();

    const result = await drive(time, sendBatch(batch, settings(time)));

    expect(result).toEqual([{ events: batch.events, outcome: "unsendable" }]);
  });

  it("drops the batch as unsendable when the serializer throws", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 200);
    const batch = aBatch();
    const serialize = () => {
      throw new Error("cannot encode");
    };

    const result = await drive(time, sendBatch(batch, settings(time, { fetch, serialize })));

    expect(result).toEqual([{ events: batch.events, outcome: "unsendable" }]);
    expect(calls).toHaveLength(0);
  });

  it("drops the batch as unsendable when the default envelope cannot be stringified", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 200);
    const event = { ...anEvent(), attributes: { big: 1n } } as unknown as ErrorEvent;

    const result = await drive(time, sendBatch(aBatch(event), settings(time, { fetch })));

    expect(result).toEqual([{ events: [event], outcome: "unsendable" }]);
    expect(calls).toHaveLength(0);
  });
});

describe("sendBatch size", () => {
  // Each event's body is its message, so a group's body measures the sum of its messages.
  const serialize = (events: readonly ErrorEvent[]) => events.map((event) => event.message).join("");

  it("splits a body over maxBatchBytes into halves, sent one after the other", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 200);
    const events = ["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc", "dddddddddd"].map(anEvent);

    const result = await drive(time, sendBatch(aBatch(...events), settings(time, { fetch, serialize, maxBatchBytes: 25 })));

    expect(calls.map((call) => call.init.body)).toEqual(["aaaaaaaaaabbbbbbbbbb", "ccccccccccdddddddddd"]);
    expect(result).toEqual([
      { events: events.slice(0, 2), outcome: "delivered" },
      { events: events.slice(2), outcome: "delivered" },
    ]);
  });

  it("measures the body in UTF-8 bytes", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 200);
    const events = ["€€€", "€€€"].map(anEvent);

    await drive(time, sendBatch(aBatch(...events), settings(time, { fetch, serialize, maxBatchBytes: 12 })));

    expect(calls.map((call) => call.init.body)).toEqual(["€€€", "€€€"]);
  });

  it("settles each half on its own", async () => {
    const time = createManualTime();
    const { fetch } = fakeFetch(time, 200, 400);
    const events = ["aaaaaaaaaa", "bbbbbbbbbb"].map(anEvent);

    const result = await drive(time, sendBatch(aBatch(...events), settings(time, { fetch, serialize, maxBatchBytes: 15 })));

    expect(result).toEqual([
      { events: events.slice(0, 1), outcome: "delivered" },
      { events: events.slice(1), outcome: "rejected" },
    ]);
  });

  it("drops a lone event over maxBatchBytes as too-large and still sends the rest", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 200);
    const events = ["aaaaaaaaaa", "b".repeat(30), "cccccccccc"].map(anEvent);

    const result = await drive(time, sendBatch(aBatch(...events), settings(time, { fetch, serialize, maxBatchBytes: 25 })));

    expect(result).toEqual([
      { events: events.slice(0, 1), outcome: "delivered" },
      { events: events.slice(1, 2), outcome: "too-large" },
      { events: events.slice(2), outcome: "delivered" },
    ]);
    expect(calls.map((call) => call.init.body)).toEqual(["aaaaaaaaaa", "cccccccccc"]);
  });
});

describe("sendBatch abort", () => {
  it("settles aborted without a request when the signal is already aborted", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 200);
    const batch = aBatch();

    const result = await drive(time, sendBatch(batch, settings(time, { fetch }), AbortSignal.abort()));

    expect(result).toEqual([{ events: batch.events, outcome: "aborted" }]);
    expect(calls).toHaveLength(0);
  });

  it("settles aborted when the signal aborts during a backoff wait", async () => {
    const time = createManualTime();
    const { fetch, calls } = fakeFetch(time, 503);
    const controller = new AbortController();
    const batch = aBatch();

    const pending = sendBatch(batch, settings(time, { fetch }), controller.signal);
    await vi.waitFor(() => {
      expect(time.pendingSleeps).toBe(1);
    });
    controller.abort(new Error("closing"));

    await expect(pending).resolves.toEqual([{ events: batch.events, outcome: "aborted" }]);
    expect(calls).toHaveLength(1);
    expect(time.pendingSleeps).toBe(0);
  });

  it("settles aborted when the request itself fails on the abort", async () => {
    const time = createManualTime();
    const controller = new AbortController();
    const reason = new Error("closing");
    const fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      controller.abort(reason);
      return Promise.reject(init?.signal?.reason);
    }) as typeof globalThis.fetch;
    const batch = aBatch();

    const result = await drive(time, sendBatch(batch, settings(time, { fetch }), controller.signal));

    expect(result).toEqual([{ events: batch.events, outcome: "aborted" }]);
  });

  it("settles every group not yet sent as aborted when the signal aborts between halves", async () => {
    const time = createManualTime();
    const controller = new AbortController();
    const events = ["aaaaaaaaaa", "bbbbbbbbbb"].map(anEvent);
    const fetch = (() => {
      controller.abort();
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof globalThis.fetch;
    const serialize = (group: readonly ErrorEvent[]) => group.map((event) => event.message).join("");

    const result = await drive(
      time,
      sendBatch(aBatch(...events), settings(time, { fetch, serialize, maxBatchBytes: 15 }), controller.signal),
    );

    expect(result).toEqual([
      { events: events.slice(0, 1), outcome: "delivered" },
      { events: events.slice(1), outcome: "aborted" },
    ]);
  });
});
