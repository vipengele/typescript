import type { Attributes } from "../attributes/attribute-value";
import { normalizeAttributes } from "../attributes/normalize-attributes";
import type { Level } from "../levels/level";
import { isLevel } from "../levels/severity";
import { systemClock } from "../time/clock";
import { BREADCRUMBS, type Scope } from "./root";

/** One step of a Unit of Work's trail, as recorded: normalized and deep-frozen. */
export interface Breadcrumb {
  /** When the step happened, as epoch milliseconds. */
  readonly time: number;
  readonly message: string;
  readonly category?: string;
  readonly level?: Level;
  readonly data?: Attributes;
}

/** What {@link Scope.addBreadcrumb} accepts. */
export interface BreadcrumbInput {
  readonly message: string;
  readonly category?: string;
  readonly level?: Level;
  /** Normalized with the default attribute limits when the breadcrumb is recorded. */
  readonly data?: Readonly<Record<string, unknown>>;
  /** Epoch milliseconds; `systemClock` is read when it is absent or not a finite number. */
  readonly time?: number;
}

/** The most breadcrumbs one buffer holds; recording one more evicts the oldest. */
const CAPACITY = 100;

type BreadcrumbNode = { readonly [BREADCRUMBS]?: unknown };

/** The buffer `scope` holds, or `undefined` when it holds none — a node another copy built without the slot. */
function bufferOf(scope: Scope): Breadcrumb[] | undefined {
  const buffer = (scope as BreadcrumbNode)[BREADCRUMBS];
  return Array.isArray(buffer) ? (buffer as Breadcrumb[]) : undefined;
}

/** Freezes `value` and every object and array reachable from it; normalized data holds no cycles to guard against. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Builds the stored form of `input`, or `undefined` when it has no string `message`. A `category`
 * that is not a string, a `level` that is not a `Level` and a `data` that is not a plain record are
 * each left out, never `undefined`-valued.
 */
function toBreadcrumb(input: BreadcrumbInput): Breadcrumb | undefined {
  if (!isRecord(input) || typeof input.message !== "string") {
    return undefined;
  }
  const { message, category, level, data, time } = input;
  return deepFreeze({
    time: typeof time === "number" && Number.isFinite(time) ? time : systemClock(),
    message,
    ...(typeof category === "string" ? { category } : {}),
    ...(isLevel(level) ? { level } : {}),
    ...(isRecord(data) ? { data: normalizeAttributes(data) } : {}),
  });
}

/**
 * Records `input` into the breadcrumb buffer `scope` holds, evicting the oldest entry once the
 * buffer holds 100. It never throws: an input without a string `message`, an input whose fields
 * throw when read and a scope holding no buffer all leave the buffer as it was.
 *
 * Framework-internal, not for application use; an application calls `Scope.addBreadcrumb`.
 */
export function addBreadcrumb(scope: Scope, input: BreadcrumbInput): void {
  try {
    const buffer = bufferOf(scope);
    if (buffer === undefined) {
      return;
    }
    const breadcrumb = toBreadcrumb(input);
    if (breadcrumb === undefined) {
      return;
    }
    buffer.push(breadcrumb);
    while (buffer.length > CAPACITY) {
      buffer.shift();
    }
  } catch {
    // A field or slot that throws on read drops the entry; the buffer is only ever appended to whole.
  }
}

/**
 * The breadcrumbs `scope`'s buffer holds, oldest first, as a new array the caller may change
 * without touching the buffer. A scope holding no buffer, or one whose slot fails to read, reads as
 * an empty trail.
 *
 * Framework-internal, not for application use.
 */
export function breadcrumbs(scope: Scope): Breadcrumb[] {
  try {
    return bufferOf(scope)?.slice() ?? [];
  } catch {
    return [];
  }
}
