import type { ErrorEvent, StackFrame } from "./event";

/** One Reporter's memory of the last event that passed deduplication. */
export interface Deduper {
  /**
   * Whether `event` duplicates the last event that passed. An event that does not becomes the last
   * one that passed, and the next event is compared with it.
   */
  isDuplicate(event: ErrorEvent): boolean;
}

/** The frame fields a duplicate must share: never `inApp`, which follows from the file. */
type FrameKey = Pick<StackFrame, "function" | "file" | "line" | "column">;

/** What deduplication compares, copied out of an event so a later change to the event never reaches it. */
interface Signature {
  readonly fingerprint: readonly string[] | undefined;
  readonly message: string | undefined;
  readonly type: string | undefined;
  readonly exceptionMessage: string | undefined;
  readonly frames: readonly FrameKey[];
}

function signatureOf(event: ErrorEvent): Signature {
  const exception = event.exception;
  const frames: readonly StackFrame[] = Array.isArray(exception?.frames) ? exception.frames : [];
  return {
    fingerprint: Array.isArray(event.fingerprint) ? [...event.fingerprint] : undefined,
    message: event.message,
    type: exception?.type,
    exceptionMessage: exception?.message,
    frames: frames.map(({ function: name, file, line, column }) => ({ function: name, file, line, column })),
  };
}

function sameList<T>(left: readonly T[], right: readonly T[], equal: (a: T, b: T) => boolean): boolean {
  return left.length === right.length && left.every((item, index) => equal(item, right[index] as T));
}

function sameFrame(left: FrameKey, right: FrameKey): boolean {
  return left.function === right.function && left.file === right.file && left.line === right.line && left.column === right.column;
}

/**
 * Two signatures are duplicates when both carry a fingerprint and the fingerprints are equal. When
 * either has none, they are duplicates when the message, the top exception's type and message, and
 * that exception's frames are equal. Attributes are never compared.
 */
function isSame(left: Signature, right: Signature): boolean {
  if (left.fingerprint !== undefined && right.fingerprint !== undefined) {
    return sameList(left.fingerprint, right.fingerprint, (a, b) => a === b);
  }
  return (
    left.message === right.message &&
    left.type === right.type &&
    left.exceptionMessage === right.exceptionMessage &&
    sameList(left.frames, right.frames, sameFrame)
  );
}

/**
 * Creates a deduper that compares each event with the last one that passed it, with no time window:
 * `A, A` passes one `A`, while `A, B, A` passes all three. An event only ever becomes the last one
 * by passing, so a run of duplicates is always compared with the event that started it.
 */
export function createDeduper(): Deduper {
  let last: Signature | undefined;
  return {
    isDuplicate(event) {
      const signature = signatureOf(event);
      if (last !== undefined && isSame(last, signature)) {
        return true;
      }
      last = signature;
      return false;
    },
  };
}
