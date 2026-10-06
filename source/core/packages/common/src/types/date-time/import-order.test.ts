import { afterEach, describe, expect, test, vi } from "vitest";

/*
 * `ZonedDateTime` imports `LocalDateTime` and `Instant`, and `LocalDate`, `LocalDateTime` and
 * `Instant` import `ZonedDateTime` back. Each module reads the others only inside method bodies,
 * so any of them can be the first one evaluated. A module that reads a binding from the cycle while
 * it evaluates fails here: each test loads one module first, alone, in a fresh module graph, and
 * then runs a conversion across the cycle.
 */
describe("each module of the date-time import cycle evaluates first", () => {
  afterEach(() => {
    vi.resetModules();
  });

  test("local-date", async () => {
    vi.resetModules();
    const { LocalDate } = await import("./local-date");
    const { ZoneId } = await import("./zone-id");

    const value = LocalDate.of(2026, 7, 15).atStartOfDay(ZoneId.of("Europe/Berlin"));

    expect(value.toInstant().toString()).toBe("2026-07-14T22:00:00Z");
  });

  test("local-date-time", async () => {
    vi.resetModules();
    const { LocalDateTime } = await import("./local-date-time");
    const { ZoneId } = await import("./zone-id");

    const value = LocalDateTime.parse("2026-07-15T13:45").atZone(ZoneId.of("Europe/Berlin"));

    expect(value.toInstant().toString()).toBe("2026-07-15T11:45:00Z");
  });

  test("instant", async () => {
    vi.resetModules();
    const { Instant } = await import("./instant");
    const { ZoneId } = await import("./zone-id");

    const value = Instant.parse("2026-07-15T11:45:00Z").atZone(ZoneId.of("Europe/Berlin"));

    expect(value.toLocalDateTime().toString()).toBe("2026-07-15T13:45");
  });

  test("zoned-date-time", async () => {
    vi.resetModules();
    const { ZonedDateTime } = await import("./zoned-date-time");
    const { LocalDateTime } = await import("./local-date-time");
    const { ZoneId } = await import("./zone-id");

    const value = ZonedDateTime.of(LocalDateTime.parse("2026-07-15T13:45"), ZoneId.of("Europe/Berlin"));

    expect(value.toInstant().atZone(ZoneId.of("America/New_York")).toLocalDateTime().toString()).toBe("2026-07-15T07:45");
  });
});
