import { describe, expect, test } from "vitest";
import { breadcrumbsSuppressed, suppressBreadcrumbs } from "./breadcrumb-suppression";

const SLOT = Symbol.for("vipengele:breadcrumbs:suppressed:v1");
const registry = globalThis as unknown as Record<symbol, number | undefined>;

describe("suppressBreadcrumbs", () => {
  test("suppresses breadcrumbs while fn runs, and only then", () => {
    expect(breadcrumbsSuppressed()).toBe(false);
    let inside: boolean | undefined;

    suppressBreadcrumbs(() => {
      inside = breadcrumbsSuppressed();
    });

    expect(inside).toBe(true);
    expect(breadcrumbsSuppressed()).toBe(false);
  });

  test("nests: an inner call ending leaves the outer one's suppression in place", () => {
    const seen: boolean[] = [];

    suppressBreadcrumbs(() => {
      suppressBreadcrumbs(() => {
        seen.push(breadcrumbsSuppressed());
      });
      seen.push(breadcrumbsSuppressed());
    });

    expect(seen).toEqual([true, true]);
    expect(breadcrumbsSuppressed()).toBe(false);
  });

  test("a throw from fn lifts the suppression and propagates unchanged", () => {
    const error = new Error("boom");

    expect(() =>
      suppressBreadcrumbs(() => {
        throw error;
      }),
    ).toThrow(error);
    expect(breadcrumbsSuppressed()).toBe(false);
  });

  test("returns fn's value unchanged", () => {
    const value = { answer: 42 };

    expect(suppressBreadcrumbs(() => value)).toBe(value);
  });

  test("returns fn's promise itself, and suppresses nothing while it is pending", async () => {
    let resolve: (value: string) => void = () => {};
    const promise = new Promise<string>((r) => {
      resolve = r;
    });

    const returned = suppressBreadcrumbs(() => promise);

    expect(returned).toBe(promise);
    expect(breadcrumbsSuppressed()).toBe(false);
    resolve("done");
    await expect(returned).resolves.toBe("done");
  });

  test("keeps its count in the realm slot every copy of the package shares", () => {
    let seenSlot: number | undefined;

    suppressBreadcrumbs(() => {
      seenSlot = registry[SLOT];
    });

    expect(seenSlot).toBe(1);
    expect(registry[SLOT]).toBe(0);
  });

  test("reads a count another copy raised in the shared slot", () => {
    registry[SLOT] = (registry[SLOT] ?? 0) + 1;
    try {
      expect(breadcrumbsSuppressed()).toBe(true);
    } finally {
      registry[SLOT] = (registry[SLOT] ?? 1) - 1;
    }
    expect(breadcrumbsSuppressed()).toBe(false);
  });

  test("adds to a count another copy holds in the shared slot and leaves that count in place", () => {
    registry[SLOT] = (registry[SLOT] ?? 0) + 1;
    let seenSlot: number | undefined;
    try {
      suppressBreadcrumbs(() => {
        seenSlot = registry[SLOT];
      });
      expect(seenSlot).toBe(2);
      expect(breadcrumbsSuppressed()).toBe(true);
    } finally {
      registry[SLOT] = (registry[SLOT] ?? 1) - 1;
    }
    expect(breadcrumbsSuppressed()).toBe(false);
  });

  test("an empty slot reads as unsuppressed, and an emptied one is restored to zero", () => {
    delete registry[SLOT];
    expect(breadcrumbsSuppressed()).toBe(false);

    suppressBreadcrumbs(() => {
      delete registry[SLOT];
    });

    expect(registry[SLOT]).toBe(0);
    expect(breadcrumbsSuppressed()).toBe(false);
  });
});
