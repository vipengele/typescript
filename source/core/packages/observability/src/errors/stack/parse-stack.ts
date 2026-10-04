import type { StackFrame } from "../event";

/**
 * The marker `serializeError` appends to a string cut at `maxStringLength`. The line it ends is a
 * fragment whose location can no longer be trusted — `/app/a.js:12…[truncated]` reads as line 12
 * of a file when the real line may be 120 — so that line is dropped rather than parsed.
 */
// biome-ignore lint/security/noSecrets: a fixed marker string, flagged only for its entropy
const TRUNCATION_SUFFIX = "…[truncated]";

const V8_FRAME = /^\s*at\s+(.*)$/;
const LINE_AND_COLUMN = /^(.+):(\d+):(\d+)$/;
const LINE_ONLY = /^(.+):(\d+)$/;
/** SpiderMonkey's `file.js line 4 > eval` (or `> Function`) location for code run through `eval`. */
const SPIDERMONKEY_EVAL = /^(.+?) line (\d+) > /;
/** The innermost parenthesised location of a V8 `eval at fn (file:l:c), <anonymous>:l:c` origin. */
const V8_EVAL_ORIGIN = /\(([^()]*)\)/;

interface Location {
  file: string;
  line: number;
  column?: number;
}

/**
 * Parses an engine stack string into frames in engine order, so `frames[0]` is the throw site.
 * Each line is read on its own as a V8 frame (`at fn (file:l:c)`, `at file:l:c`) or a
 * SpiderMonkey/JavaScriptCore frame (`fn@file:l:c`, `@file:l:c`); a line that is neither — an
 * `Error: message` header, however many lines it spans, a `[native code]` frame, a truncated tail —
 * is dropped. `inApp` is left unset. Never throws: anything but a non-empty string yields `[]`.
 */
export function parseStack(stack: unknown): StackFrame[] {
  if (typeof stack !== "string" || stack === "") {
    return [];
  }
  const frames: StackFrame[] = [];
  for (const line of stack.split(/\r?\n/)) {
    if (line.endsWith(TRUNCATION_SUFFIX)) {
      continue;
    }
    const frame = parseLine(line);
    if (frame !== undefined) {
      frames.push(frame);
    }
  }
  return frames;
}

function parseLine(line: string): StackFrame | undefined {
  const v8 = V8_FRAME.exec(line);
  if (v8 !== null) {
    return parseV8Frame(v8[1] as string);
  }
  return parseAtSignFrame(line.trim());
}

/**
 * `body` is everything after `at `. A trailing balanced `(…)` holds the location and everything
 * before it is the function — balanced, because an eval origin or a `data:` URL nests parentheses
 * of its own. A location V8 prints as `native`, `<anonymous>` or `index 0` yields a frame with a
 * function and no file.
 */
function parseV8Frame(body: string): StackFrame | undefined {
  const text = body.startsWith("async ") ? body.slice("async ".length).trim() : body.trim();
  if (text === "") {
    return undefined;
  }
  const open = text.endsWith(")") ? openingParenOfTrailingGroup(text) : -1;
  if (open >= 0) {
    return withFunction(text.slice(0, open).trim(), parseV8Location(text.slice(open + 1, -1)));
  }
  const location = parseLocation(text);
  return location === undefined ? { function: text } : toFrame(location);
}

/** The index of the `(` matching `text`'s final `)`, or -1 when the parentheses do not balance. */
function openingParenOfTrailingGroup(text: string): number {
  let depth = 0;
  for (let index = text.length - 1; index >= 0; index--) {
    const char = text[index];
    if (char === ")") {
      depth++;
    } else if (char === "(") {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

/** An `eval at fn (file:l:c), <anonymous>:l:c` location points at the file that called `eval`. */
function parseV8Location(text: string): Location | undefined {
  if (!text.startsWith("eval at ")) {
    return parseLocation(text);
  }
  const origin = V8_EVAL_ORIGIN.exec(text);
  return origin === null ? undefined : parseLocation(origin[1] as string);
}

/**
 * Splits at the first `@`: SpiderMonkey and JavaScriptCore function names carry none, while a file
 * may (`node_modules/@scope/pkg`). A `[native code]` location, or one with no line number — which
 * is what an `Error: user@example.com` header line looks like — yields no frame.
 */
function parseAtSignFrame(line: string): StackFrame | undefined {
  const at = line.indexOf("@");
  if (at < 0) {
    return undefined;
  }
  const locationText = line.slice(at + 1);
  const evalSite = SPIDERMONKEY_EVAL.exec(locationText);
  const location = evalSite === null ? parseLocation(locationText) : toLocation(evalSite[1] as string, evalSite[2] as string, undefined);
  return location === undefined ? undefined : withFunction(line.slice(0, at).trim(), location);
}

/**
 * Reads `file:line:column` or `file:line` from the end of the string, so the colon of a Windows
 * drive (`C:\app\x.js:1:2`) or a URL scheme (`node:`, `file:///C:/`, `webpack-internal:///`,
 * `data:`) stays inside the file.
 */
function parseLocation(text: string): Location | undefined {
  const trimmed = text.trim();
  const full = LINE_AND_COLUMN.exec(trimmed);
  if (full !== null) {
    return toLocation(full[1] as string, full[2] as string, full[3]);
  }
  const lineOnly = LINE_ONLY.exec(trimmed);
  return lineOnly === null ? undefined : toLocation(lineOnly[1] as string, lineOnly[2] as string, undefined);
}

/** A line or column too large to be a safe integer is not a position anything can point at. */
function toLocation(file: string, line: string, column: string | undefined): Location | undefined {
  const lineNumber = Number(line);
  if (file.trim() === "" || !Number.isSafeInteger(lineNumber)) {
    return undefined;
  }
  const location: Location = { file: file.trim(), line: lineNumber };
  if (column !== undefined && Number.isSafeInteger(Number(column))) {
    location.column = Number(column);
  }
  return location;
}

function toFrame(location: Location | undefined): StackFrame {
  if (location === undefined) {
    return {};
  }
  const frame: StackFrame = { file: location.file, line: location.line };
  if (location.column !== undefined) {
    frame.column = location.column;
  }
  return frame;
}

function withFunction(name: string, location: Location | undefined): StackFrame | undefined {
  const frame = toFrame(location);
  if (name !== "") {
    frame.function = name;
  }
  return Object.keys(frame).length === 0 ? undefined : frame;
}
