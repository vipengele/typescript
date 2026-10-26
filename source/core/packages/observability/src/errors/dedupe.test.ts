import { describe, expect, it } from "vitest";
import { createDeduper } from "./dedupe";
import type { ErrorEvent, ExceptionRecord, StackFrame } from "./event";

const FRAMES: StackFrame[] = [
  { function: "render", file: "app.js", line: 10, column: 5, inApp: true },
  { function: "main", file: "app.js", line: 2, column: 1, inApp: true },
];

function anException(overrides: Partial<ExceptionRecord> = {}): ExceptionRecord {
  return { type: "TypeError", message: "boom", frames: FRAMES.map((frame) => ({ ...frame })), ...overrides };
}

function anEvent(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    id: "0".repeat(32),
    time: 1,
    level: "error",
    exception: anException(),
    mechanism: { handled: true, source: "capture" },
    attributes: {},
    ...overrides,
  };
}

describe("createDeduper", () => {
  it("passes the first event, and finds an identical one after it a duplicate", () => {
    const deduper = createDeduper();

    expect(deduper.isDuplicate(anEvent())).toBe(false);
    expect(deduper.isDuplicate(anEvent({ id: "1".repeat(32), time: 2 }))).toBe(true);
  });

  it("compares with the last event that passed only, so A, B, A all pass", () => {
    const deduper = createDeduper();

    expect(deduper.isDuplicate(anEvent())).toBe(false);
    expect(deduper.isDuplicate(anEvent({ exception: anException({ message: "other" }) }))).toBe(false);
    expect(deduper.isDuplicate(anEvent())).toBe(false);
  });

  it("keeps comparing a run of duplicates with the event that started it", () => {
    const deduper = createDeduper();

    deduper.isDuplicate(anEvent());

    expect(deduper.isDuplicate(anEvent())).toBe(true);
    expect(deduper.isDuplicate(anEvent())).toBe(true);
  });

  it("ignores attributes, time, id, level and inApp", () => {
    const deduper = createDeduper();

    deduper.isDuplicate(anEvent({ attributes: { counter: 1 } }));

    expect(
      deduper.isDuplicate(
        anEvent({
          id: "f".repeat(32),
          time: 99,
          level: "fatal",
          attributes: { counter: 2 },
          exception: anException({ frames: FRAMES.map((frame) => ({ ...frame, inApp: false })) }),
        }),
      ),
    ).toBe(true);
  });

  it.for([
    ["the exception type", { exception: anException({ type: "RangeError" }) }],
    ["the exception message", { exception: anException({ message: "bang" }) }],
    ["a frame's function", { exception: anException({ frames: [{ ...FRAMES[0], function: "paint" }, FRAMES[1] as StackFrame] }) }],
    ["a frame's file", { exception: anException({ frames: [{ ...FRAMES[0], file: "lib.js" }, FRAMES[1] as StackFrame] }) }],
    ["a frame's line", { exception: anException({ frames: [{ ...FRAMES[0], line: 11 }, FRAMES[1] as StackFrame] }) }],
    ["a frame's column", { exception: anException({ frames: [{ ...FRAMES[0], column: 6 }, FRAMES[1] as StackFrame] }) }],
    ["the number of frames", { exception: anException({ frames: [FRAMES[0] as StackFrame] }) }],
    ["the message", { message: "context" }],
    ["having no exception", { exception: undefined, message: "boom" }],
  ] as const)("finds an event that differs in %s no duplicate", ([, overrides]) => {
    const deduper = createDeduper();

    deduper.isDuplicate(anEvent());

    expect(deduper.isDuplicate(anEvent(overrides as Partial<ErrorEvent>))).toBe(false);
  });

  it("finds two captured messages with the same text duplicates", () => {
    const deduper = createDeduper();

    expect(deduper.isDuplicate(anEvent({ exception: undefined, message: "hello" }))).toBe(false);
    expect(deduper.isDuplicate(anEvent({ exception: undefined, message: "hello" }))).toBe(true);
    expect(deduper.isDuplicate(anEvent({ exception: undefined, message: "goodbye" }))).toBe(false);
  });

  it("finds events with equal fingerprints duplicates, whatever else differs", () => {
    const deduper = createDeduper();

    deduper.isDuplicate(anEvent({ fingerprint: ["checkout", "timeout"] }));

    expect(deduper.isDuplicate(anEvent({ fingerprint: ["checkout", "timeout"], exception: anException({ type: "RangeError" }) }))).toBe(
      true,
    );
  });

  it("finds events with different fingerprints no duplicate, even when everything else is equal", () => {
    const deduper = createDeduper();

    deduper.isDuplicate(anEvent({ fingerprint: ["checkout"] }));

    expect(deduper.isDuplicate(anEvent({ fingerprint: ["payment"] }))).toBe(false);
    expect(deduper.isDuplicate(anEvent({ fingerprint: ["payment", "extra"] }))).toBe(false);
  });

  it("compares structurally when only one of the two events carries a fingerprint", () => {
    const deduper = createDeduper();

    deduper.isDuplicate(anEvent({ fingerprint: ["checkout"] }));

    expect(deduper.isDuplicate(anEvent())).toBe(true);
    expect(deduper.isDuplicate(anEvent({ fingerprint: ["payment"], exception: anException({ message: "other" }) }))).toBe(false);
  });

  it("treats a fingerprint that is not an array as absent", () => {
    const deduper = createDeduper();

    deduper.isDuplicate(anEvent({ fingerprint: ["checkout"] }));

    expect(deduper.isDuplicate(anEvent({ fingerprint: "payment" as never }))).toBe(true);
  });

  it("treats an exception without a frame list as one with no frames", () => {
    const deduper = createDeduper();
    const { frames: _, ...frameless } = anException();

    deduper.isDuplicate(anEvent({ exception: anException({ frames: [] }) }));

    expect(deduper.isDuplicate(anEvent({ exception: frameless as ExceptionRecord }))).toBe(true);
  });

  it("compares with a copy of the last event, so a later change to that event never reaches it", () => {
    const deduper = createDeduper();
    const first = anEvent({ fingerprint: ["a"] });

    deduper.isDuplicate(first);
    (first.exception as ExceptionRecord).message = "changed";
    (first.exception as ExceptionRecord).frames.length = 0;
    first.fingerprint?.push("b");

    expect(deduper.isDuplicate(anEvent())).toBe(true);
    expect(deduper.isDuplicate(anEvent({ fingerprint: ["a"] }))).toBe(true);
  });

  it("keeps the last event of each deduper apart", () => {
    const first = createDeduper();
    const second = createDeduper();

    first.isDuplicate(anEvent());

    expect(second.isDuplicate(anEvent())).toBe(false);
  });
});
