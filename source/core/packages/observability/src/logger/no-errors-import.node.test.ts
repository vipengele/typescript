import { describe, expect, test } from "vitest";

// The package declares no Node types and lint rejects a `node:` import in shipped source, so the
// two built-ins this suite reads are typed here and reached through `process.getBuiltinModule`.
interface NodeFs {
  readdirSync(path: string, options: { recursive: true }): string[];
  readFileSync(path: string, encoding: "utf8"): string;
}
interface NodePath {
  resolve(...segments: string[]): string;
  dirname(path: string): string;
  sep: string;
}
const nodeProcess = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process;
const fs = nodeProcess.getBuiltinModule("node:fs") as NodeFs;
const path = nodeProcess.getBuiltinModule("node:path") as NodePath;

const LOGGER_DIR = path.resolve(new URL(".", import.meta.url).pathname);
const ERRORS_DIR = path.resolve(LOGGER_DIR, "..", "errors");

const SPECIFIER_PATTERNS = [
  /\b(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

/** Every module specifier `source` imports, re-exports from or dynamically imports. */
function moduleSpecifiers(source: string): string[] {
  return SPECIFIER_PATTERNS.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1] as string));
}

/** The specifiers in `source`, a file in `directory`, that resolve into `src/errors/`. */
function errorsImports(source: string, directory: string): string[] {
  return moduleSpecifiers(source).filter((specifier) => {
    if (!specifier.startsWith(".")) {
      return false;
    }
    const target = path.resolve(directory, specifier);
    return target === ERRORS_DIR || target.startsWith(ERRORS_DIR + path.sep);
  });
}

describe("the logger does not depend on the error reporter", () => {
  test("detects every import form that reaches src/errors", () => {
    const source = [
      'import { a } from "../errors/event";',
      'import type { B } from "../errors";',
      'export { c } from "../errors/transport";',
      'import "../errors/side-effect";',
      'const d = await import("../errors/lazy");',
      'import { ok } from "../redaction";',
      'import { fine } from "./errors-like";',
    ].join("\n");
    expect(errorsImports(source, LOGGER_DIR)).toEqual([
      "../errors/event",
      "../errors",
      "../errors/transport",
      "../errors/side-effect",
      "../errors/lazy",
    ]);
  });

  test("resolves a specifier against the importing file's directory", () => {
    expect(errorsImports('import { a } from "../../errors/event";', path.resolve(LOGGER_DIR, "formatters"))).toEqual([
      "../../errors/event",
    ]);
    expect(errorsImports('import { a } from "../errors/event";', path.resolve(LOGGER_DIR, "formatters"))).toEqual([]);
  });

  test("no file under src/logger imports from src/errors", () => {
    // This file is skipped: its fixtures are import statements written as string literals.
    const files = fs
      .readdirSync(LOGGER_DIR, { recursive: true })
      .filter((file) => file.endsWith(".ts") && file !== "no-errors-import.node.test.ts");
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.flatMap((file) => {
      const absolute = path.resolve(LOGGER_DIR, file);
      return errorsImports(fs.readFileSync(absolute, "utf8"), path.dirname(absolute)).map((specifier) => `${file}: ${specifier}`);
    });
    expect(offenders).toEqual([]);
  });
});
