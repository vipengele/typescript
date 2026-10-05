import { describe, expect, test } from "vitest";
import { isZoneResolutionError } from "./errors";
import { Instant } from "./instant";
import { LocalDateTime } from "./local-date-time";
import type { Disambiguation } from "./zone-resolve";
import { ZoneId } from "./zone-id";
import { ZonedDateTime } from "./zoned-date-time";

const MODES = ["compatible", "earlier", "later", "reject"] as const satisfies readonly Disambiguation[];

/**
 * One transition: the local window `[windowStart, windowEnd)` the zone skips (a gap) or reads
 * twice (an overlap), the offsets either side of it in seconds, and one time inside the window
 * with the value each disambiguation settles it to, `null` where it throws.
 */
interface Transition {
  readonly name: string;
  readonly zone: string;
  readonly kind: "gap" | "overlap";
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly offsetBefore: number;
  readonly offsetAfter: number;
  readonly sample: string;
  readonly expected: Readonly<Record<Disambiguation, string | null>>;
}

const TRANSITIONS: readonly Transition[] = [
  {
    name: "Berlin spring-forward gap",
    zone: "Europe/Berlin",
    kind: "gap",
    windowStart: "2026-03-29T02:00",
    windowEnd: "2026-03-29T03:00",
    offsetBefore: 3600,
    offsetAfter: 7200,
    sample: "2026-03-29T02:30",
    expected: {
      compatible: "2026-03-29T03:30+02:00",
      earlier: "2026-03-29T01:30+01:00",
      later: "2026-03-29T03:30+02:00",
      reject: null,
    },
  },
  {
    name: "Berlin fall-back overlap",
    zone: "Europe/Berlin",
    kind: "overlap",
    windowStart: "2026-10-25T02:00",
    windowEnd: "2026-10-25T03:00",
    offsetBefore: 7200,
    offsetAfter: 3600,
    sample: "2026-10-25T02:30",
    expected: {
      compatible: "2026-10-25T02:30+02:00",
      earlier: "2026-10-25T02:30+02:00",
      later: "2026-10-25T02:30+01:00",
      reject: null,
    },
  },
  {
    name: "New York spring-forward gap",
    zone: "America/New_York",
    kind: "gap",
    windowStart: "2026-03-08T02:00",
    windowEnd: "2026-03-08T03:00",
    offsetBefore: -18_000,
    offsetAfter: -14_400,
    sample: "2026-03-08T02:30",
    expected: {
      compatible: "2026-03-08T03:30-04:00",
      earlier: "2026-03-08T01:30-05:00",
      later: "2026-03-08T03:30-04:00",
      reject: null,
    },
  },
  {
    name: "New York fall-back overlap",
    zone: "America/New_York",
    kind: "overlap",
    windowStart: "2026-11-01T01:00",
    windowEnd: "2026-11-01T02:00",
    offsetBefore: -14_400,
    offsetAfter: -18_000,
    sample: "2026-11-01T01:30",
    expected: {
      compatible: "2026-11-01T01:30-04:00",
      earlier: "2026-11-01T01:30-04:00",
      later: "2026-11-01T01:30-05:00",
      reject: null,
    },
  },
  {
    name: "Lord Howe half-hour overlap",
    zone: "Australia/Lord_Howe",
    kind: "overlap",
    windowStart: "2026-04-05T01:30",
    windowEnd: "2026-04-05T02:00",
    offsetBefore: 39_600,
    offsetAfter: 37_800,
    sample: "2026-04-05T01:45",
    expected: {
      compatible: "2026-04-05T01:45+11:00",
      earlier: "2026-04-05T01:45+11:00",
      later: "2026-04-05T01:45+10:30",
      reject: null,
    },
  },
  {
    name: "Lord Howe half-hour gap",
    zone: "Australia/Lord_Howe",
    kind: "gap",
    windowStart: "2026-10-04T02:00",
    windowEnd: "2026-10-04T02:30",
    offsetBefore: 37_800,
    offsetAfter: 39_600,
    sample: "2026-10-04T02:15",
    expected: {
      compatible: "2026-10-04T02:45+11:00",
      earlier: "2026-10-04T01:45+10:30",
      later: "2026-10-04T02:45+11:00",
      reject: null,
    },
  },
  {
    name: "Apia skipped day",
    zone: "Pacific/Apia",
    kind: "gap",
    windowStart: "2011-12-30T00:00",
    windowEnd: "2011-12-31T00:00",
    offsetBefore: -36_000,
    offsetAfter: 50_400,
    sample: "2011-12-30T12:00",
    expected: {
      compatible: "2011-12-31T12:00+14:00",
      earlier: "2011-12-29T12:00-10:00",
      later: "2011-12-31T12:00+14:00",
      reject: null,
    },
  },
];

/** The instant the local date-time `local` names when read at the fixed offset `offsetSeconds`. */
function readAt(local: string, offsetSeconds: number): Instant {
  const { date, time } = LocalDateTime.parse(local);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  const utc = `${date}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}.${pad(time.nanosecond, 9)}Z`;
  return Instant.parse(utc).minusSeconds(offsetSeconds);
}

/** The local date-time a wall clock at the fixed offset `offsetSeconds` shows at `instant`. */
function wallClock(instant: Instant, offsetSeconds: number): string {
  return LocalDateTime.parse(instant.plusSeconds(offsetSeconds).toString().slice(0, -1)).toString();
}

/** The local date-time `seconds` seconds and `nanos` nanoseconds after `local`. */
function after(local: string, seconds: number, nanos = 0): string {
  return wallClock(readAt(local, 0).plusSeconds(seconds).plusNanos(nanos), 0);
}

/** The error `fn` throws, or `undefined` when it returns. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** A value's local date-time, offset and instant as plain strings and numbers, for one `toEqual`. */
function parts(value: ZonedDateTime): { local: string; offsetSeconds: number; instant: string } {
  return { local: value.toLocalDateTime().toString(), offsetSeconds: value.offsetSeconds, instant: value.toInstant().toString() };
}

/** Local times inside a transition's window: its first instant, two inside it and its last nanosecond. */
function windowSamples(transition: Transition): string[] {
  const length = readAt(transition.windowEnd, 0).toEpochSecond() - readAt(transition.windowStart, 0).toEpochSecond();
  return [
    transition.windowStart,
    after(transition.windowStart, 1, 1),
    after(transition.windowStart, Math.floor(length / 2), 123_456_789),
    after(transition.windowEnd, 0, -1),
  ];
}

describe.for(TRANSITIONS)("$name", (transition) => {
  const zone = ZoneId.of(transition.zone);
  const shift = transition.offsetAfter - transition.offsetBefore;

  test("the sample time is in the window", () => {
    const sample = LocalDateTime.parse(transition.sample);
    expect(LocalDateTime.compare(sample, LocalDateTime.parse(transition.windowStart))).toBeGreaterThan(0);
    expect(LocalDateTime.compare(sample, LocalDateTime.parse(transition.windowEnd))).toBeLessThan(0);
  });

  test.for(MODES)("%s settles the sample time as the table says", (mode) => {
    const expected = transition.expected[mode];
    const local = LocalDateTime.parse(transition.sample);
    if (expected === null) {
      const error = thrown(() => ZonedDateTime.of(local, zone, { disambiguation: mode }));
      expect(isZoneResolutionError(error)).toBe(true);
      expect((error as Error).message).toContain(transition.kind === "gap" ? "does not exist" : "is ambiguous");
      expect(isZoneResolutionError(thrown(() => local.atZone(zone, { disambiguation: mode })))).toBe(true);
      return;
    }
    expect(ZonedDateTime.of(local, zone, { disambiguation: mode }).toString()).toBe(`${expected}[${zone.id}]`);
    expect(local.atZone(zone, { disambiguation: mode }).toString()).toBe(`${expected}[${zone.id}]`);
  });

  test.for(MODES)("%s settles every time in the window by the transition's offsets", (mode) => {
    for (const text of windowSamples(transition)) {
      const local = LocalDateTime.parse(text);
      if (mode === "reject") {
        expect(isZoneResolutionError(thrown(() => ZonedDateTime.of(local, zone, { disambiguation: mode })))).toBe(true);
        continue;
      }
      const takeAfter = mode === "later" || (mode === "compatible" && transition.kind === "gap");
      const offsetSeconds = takeAfter ? transition.offsetAfter : transition.offsetBefore;
      // A gap time names the instant it reads as at the offset not taken; an overlap time keeps its reading.
      const instant =
        transition.kind === "gap"
          ? readAt(text, takeAfter ? transition.offsetBefore : transition.offsetAfter)
          : readAt(text, offsetSeconds);
      const expectedLocal = transition.kind === "gap" ? after(text, takeAfter ? shift : -shift) : local.toString();
      expect(parts(ZonedDateTime.of(local, zone, { disambiguation: mode }))).toEqual({
        local: expectedLocal,
        offsetSeconds,
        instant: instant.toString(),
      });
    }
  });

  test.for(MODES)("%s reads the edges of the window once", (mode) => {
    const lastBefore = after(transition.windowStart, 0, -1);
    expect(parts(ZonedDateTime.of(LocalDateTime.parse(lastBefore), zone, { disambiguation: mode }))).toEqual({
      local: lastBefore,
      offsetSeconds: transition.offsetBefore,
      instant: readAt(lastBefore, transition.offsetBefore).toString(),
    });
    const firstAfter = LocalDateTime.parse(transition.windowEnd).toString();
    expect(parts(ZonedDateTime.of(LocalDateTime.parse(firstAfter), zone, { disambiguation: mode }))).toEqual({
      local: firstAfter,
      offsetSeconds: transition.offsetAfter,
      instant: readAt(firstAfter, transition.offsetAfter).toString(),
    });
  });

  test("the zone's offset changes at the window's instant", () => {
    // A gap opens at its first local time on the old offset; an overlap closes at its last on the old offset.
    const at = readAt(transition.kind === "gap" ? transition.windowStart : transition.windowEnd, transition.offsetBefore);
    expect(zone.offsetSecondsAt(at.minusSeconds(1))).toBe(transition.offsetBefore);
    expect(zone.offsetSecondsAt(at)).toBe(transition.offsetAfter);
  });
});
