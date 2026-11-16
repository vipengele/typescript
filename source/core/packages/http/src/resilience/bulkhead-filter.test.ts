import { createBulkhead, isBulkheadFullError } from "@vipengele/ts-core-resilience";
import { describe, expect, test } from "vitest";
import { HttpClient } from "../client";
import type { HttpFetch } from "../context";
import { Order } from "../filter";
import { bulkheadFilter } from "./bulkhead-filter";

const URL_A = "https://h.test/a";

describe("bulkheadFilter", () => {
  test("is named bulkhead at Order.BULKHEAD", () => {
    const built = bulkheadFilter(createBulkhead("http", { maxConcurrent: 1 }));

    expect(built.name).toBe("bulkhead");
    expect(built.order).toBe(Order.BULKHEAD);
  });

  test("rejects with BulkheadFullError when full, without calling fetch, and frees the permit on settle", async () => {
    const policy = createBulkhead("http", { maxConcurrent: 1 });
    let calls = 0;
    let release: (response: Response) => void = () => {};
    const fetch: HttpFetch = () => {
      calls += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const client = HttpClient.builder().fetch(fetch).filter(bulkheadFilter(policy)).build();

    const first = client.get(URL_A).text();
    const error = await client
      .get(URL_A)
      .send()
      .catch((caught: unknown) => caught);

    expect(isBulkheadFullError(error)).toBe(true);
    expect(calls).toBe(1);

    release(new Response("first"));
    await expect(first).resolves.toBe("first");
    const again = client.get(URL_A).text();
    release(new Response("again"));
    await expect(again).resolves.toBe("again");
    expect(calls).toBe(2);
  });
});
