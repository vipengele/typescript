import type { StackFrame } from "../event";

const FILE_SCHEME = /^file:\/\//i;
const NODE_SCHEME = /^node:/i;
/** A drive-letter path as `file:///C:/…` leaves it once the scheme is stripped: `/C:/…`. */
const SLASHED_DRIVE = /^\/[A-Za-z]:\//;
const DRIVE = /^([A-Za-z]):\//;

/**
 * Returns a copy of each frame with `inApp` set. A frame is not in-app when it has no file, when
 * its file — a path or an `http(s)://` URL — has a `node_modules` segment, or when its file is a
 * `node:` builtin. Otherwise, with no `projectRoot` every frame is in-app; with one, only a frame
 * whose file sits under the root on a path boundary is (`/app` covers `/app/x.js`, not
 * `/application/x.js`). The root may be a filesystem path or a URL prefix; an empty or
 * whitespace-only root counts as unset. Never throws and never mutates its input: a frame that
 * cannot be read becomes `{ inApp: false }`.
 */
export function markInApp(frames: StackFrame[], projectRoot?: string): StackFrame[] {
  if (!Array.isArray(frames)) {
    return [];
  }
  const root = normalizeRoot(projectRoot);
  return frames.map((frame) => {
    try {
      return { ...frame, inApp: isInApp(frame.file, root) };
    } catch {
      return { inApp: false };
    }
  });
}

/**
 * The root in comparable form with trailing slashes removed, or `undefined` when unset. A root of
 * `/` normalises to `""`, which every absolute path extends on a boundary.
 */
function normalizeRoot(projectRoot: unknown): string | undefined {
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") {
    return undefined;
  }
  return normalize(projectRoot.trim()).replace(/\/+$/, "");
}

function isInApp(file: unknown, root: string | undefined): boolean {
  if (typeof file !== "string" || file.trim() === "" || NODE_SCHEME.test(file.trim())) {
    return false;
  }
  const path = normalize(file.trim());
  if (path.split("/").includes("node_modules")) {
    return false;
  }
  return root === undefined || path === root || path.startsWith(`${root}/`);
}

/**
 * Backslashes become slashes, a `file://` URL becomes the path it names (percent-decoded, its
 * drive letter unslashed), and a drive letter is lower-cased, so `C:\app\x.js`,
 * `file:///C:/app/x.js` and `c:/app/x.js` compare equal.
 */
function normalize(value: string): string {
  let path = value.replace(/\\/g, "/");
  if (FILE_SCHEME.test(path)) {
    path = decode(path.replace(FILE_SCHEME, ""));
    if (SLASHED_DRIVE.test(path)) {
      path = path.slice(1);
    }
  }
  return path.replace(DRIVE, (_, letter: string) => `${letter.toLowerCase()}:/`);
}

/** A malformed escape (`%E0%A4%A`) leaves the path as written rather than throwing. */
function decode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
