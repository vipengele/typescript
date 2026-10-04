import { describe, expect, it } from "vitest";
import type { StackFrame } from "../event";
import { markInApp } from "./in-app";

function inApp(file: unknown, projectRoot?: string): boolean | undefined {
  return markInApp([{ file } as StackFrame], projectRoot)[0]?.inApp;
}

describe("markInApp", () => {
  it("returns a copy of each frame with inApp set, leaving the input untouched", () => {
    const frames: StackFrame[] = [
      { function: "f", file: "/app/a.js", line: 1, column: 2 },
      { function: "g", file: "/app/node_modules/x/b.js", line: 3 },
    ];

    const marked = markInApp(frames);

    expect(marked).toEqual([
      { function: "f", file: "/app/a.js", line: 1, column: 2, inApp: true },
      { function: "g", file: "/app/node_modules/x/b.js", line: 3, inApp: false },
    ]);
    expect(marked[0]).not.toBe(frames[0]);
    expect(frames[0]).not.toHaveProperty("inApp");
  });

  it("returns no frames for no frames", () => {
    expect(markInApp([])).toEqual([]);
  });

  it("marks a frame with no file not in-app", () => {
    expect(markInApp([{ function: "f" }])).toEqual([{ function: "f", inApp: false }]);
  });

  describe("with no root", () => {
    it.each<[string, string]>([
      ["a POSIX path", "/home/me/app/src/a.js"],
      ["an http URL", "http://localhost:5173/src/a.js"],
      ["an https URL", "https://app.example.com/assets/index-abc.js"],
      ["a Windows path", "C:\\app\\src\\a.js"],
      ["a file URL", "file:///home/me/app/a.js"],
      ["a relative path", "src/a.js"],
    ])("marks %s in-app", (_, file) => {
      expect(inApp(file)).toBe(true);
    });

    it.each<[string, string]>([
      ["a POSIX node_modules path", "/app/node_modules/pkg/index.js"],
      ["a scoped node_modules path", "/app/node_modules/@scope/pkg/index.js"],
      ["a Windows node_modules path", "C:\\app\\node_modules\\pkg\\index.js"],
      ["a file URL into node_modules", "file:///app/node_modules/pkg/index.js"],
      ["an http URL into node_modules", "http://localhost:5173/node_modules/.vite/deps/pkg.js?v=1"],
      ["an https URL into node_modules", "https://cdn.example.com/node_modules/pkg/index.js"],
      ["a relative node_modules path", "node_modules/pkg/index.js"],
      ["a node: builtin", "node:internal/process/task_queues"],
      ["an upper-case node: builtin", "NODE:fs"],
      ["an empty file", ""],
      ["a whitespace-only file", "   "],
    ])("marks %s not in-app", (_, file) => {
      expect(inApp(file)).toBe(false);
    });

    it("needs node_modules as a whole segment", () => {
      expect(inApp("/app/my_node_modules/a.js")).toBe(true);
      expect(inApp("/app/node_modules_backup/a.js")).toBe(true);
    });
  });

  describe("with a filesystem root", () => {
    it("marks a file under the root in-app and one outside it not", () => {
      expect(inApp("/app/src/a.js", "/app")).toBe(true);
      expect(inApp("/other/a.js", "/app")).toBe(false);
    });

    it("matches the root on a path boundary only", () => {
      expect(inApp("/application/a.js", "/app")).toBe(false);
      expect(inApp("/app", "/app")).toBe(true);
    });

    it.each<[string]>([["/app/"], ["/app//"], ["  /app/  "]])("handles the root %j", (root) => {
      expect(inApp("/app/src/a.js", root)).toBe(true);
      expect(inApp("/application/a.js", root)).toBe(false);
    });

    it("treats a root of / as covering every absolute path", () => {
      expect(inApp("/anything/a.js", "/")).toBe(true);
      expect(inApp("relative/a.js", "/")).toBe(false);
    });

    it("still marks node_modules and node: frames under the root not in-app", () => {
      expect(inApp("/app/node_modules/pkg/a.js", "/app")).toBe(false);
      expect(inApp("node:fs", "/app")).toBe(false);
    });

    it("compares a file URL against a path root", () => {
      expect(inApp("file:///app/src/a.js", "/app")).toBe(true);
      expect(inApp("FILE:///app/src/a.js", "/app/")).toBe(true);
      expect(inApp("file:///application/a.js", "/app")).toBe(false);
    });

    it("compares a path against a file URL root", () => {
      expect(inApp("/app/src/a.js", "file:///app/")).toBe(true);
      expect(inApp("/application/a.js", "file:///app/")).toBe(false);
    });

    it("percent-decodes a file URL", () => {
      expect(inApp("file:///home/john%20doe/app/a.js", "/home/john doe/app")).toBe(true);
    });

    it("leaves a file URL with a malformed escape as written", () => {
      expect(inApp("file:///app/%E0%A4%A/a.js", "/app")).toBe(true);
      expect(inApp("file:///app/%E0%A4%A/a.js", "/other")).toBe(false);
    });
  });

  describe("with a Windows root", () => {
    it.each<[string, string]>([
      ["a backslash path", "C:\\app\\src\\a.js"],
      ["a forward-slash path", "C:/app/src/a.js"],
      ["a lower-case drive", "c:\\app\\src\\a.js"],
      ["a file URL", "file:///C:/app/src/a.js"],
      ["a file URL with a lower-case drive", "file:///c:/app/src/a.js"],
    ])("marks %s under the root in-app", (_, file) => {
      expect(inApp(file, "C:\\app\\")).toBe(true);
      expect(inApp(file, "file:///C:/app")).toBe(true);
    });

    it("matches on a path boundary and on the drive", () => {
      expect(inApp("C:\\application\\a.js", "C:\\app")).toBe(false);
      expect(inApp("D:\\app\\a.js", "C:\\app")).toBe(false);
    });

    it("marks a Windows node_modules file under the root not in-app", () => {
      expect(inApp("C:\\app\\node_modules\\pkg\\a.js", "C:\\app")).toBe(false);
    });
  });

  describe("with a URL root", () => {
    it.each<[string]>([["https://app.example.com/"], ["https://app.example.com"]])("marks files under %s in-app", (root) => {
      expect(inApp("https://app.example.com/assets/index.js", root)).toBe(true);
      expect(inApp("https://app.example.com.evil.test/assets/index.js", root)).toBe(false);
      expect(inApp("https://cdn.example.com/lib.js", root)).toBe(false);
      expect(inApp("/app/a.js", root)).toBe(false);
    });

    it("matches a URL root with a path on a path boundary", () => {
      expect(inApp("http://localhost:5173/src/a.js", "http://localhost:5173/src/")).toBe(true);
      expect(inApp("http://localhost:5173/srcs/a.js", "http://localhost:5173/src/")).toBe(false);
    });

    it("marks a node_modules URL under the root not in-app", () => {
      expect(inApp("http://localhost:5173/node_modules/.vite/deps/pkg.js", "http://localhost:5173/")).toBe(false);
    });
  });

  describe("with an unset root", () => {
    it.each<[string, unknown]>([
      ["an empty string", ""],
      ["whitespace only", " \t\n "],
      ["undefined", undefined],
      ["a number", 42],
      ["an object", { toString: () => "/app" }],
      ["null", null],
    ])("treats a root of %s as unset", (_, root) => {
      expect(inApp("/anywhere/a.js", root as string)).toBe(true);
      expect(inApp("/anywhere/node_modules/a.js", root as string)).toBe(false);
    });
  });

  describe("with hostile input", () => {
    it.each<[string, unknown]>([
      ["null", null],
      ["a number", 42],
      ["NaN", Number.NaN],
      ["a boolean", true],
      ["a symbol", Symbol("file")],
      ["a bigint", 10n],
      ["an array", ["/app/a.js"]],
      ["a String object", new String("/app/a.js")],
      [
        "an object whose toString throws",
        {
          toString() {
            throw new Error("boom");
          },
        },
      ],
      ["a function", () => "/app/a.js"],
    ])("marks a file of %s not in-app without throwing", (_, file) => {
      expect(() => inApp(file, "/app")).not.toThrow();
      expect(inApp(file, "/app")).toBe(false);
      expect(inApp(file)).toBe(false);
    });

    it.each<[string, string]>([
      ["a lone percent sign", "file:///%"],
      ["a bare file scheme", "file://"],
      ["only slashes", "////"],
      ["only backslashes", "\\\\\\"],
      ["control characters", "/app/\u0000\u0007/a.js"],
      ["a lone surrogate", "/app/\uD800/a.js"],
      ["a very long path", `/app/${"a/".repeat(100_000)}a.js`],
    ])("does not throw on a file of %s", (_, file) => {
      expect(() => inApp(file, "/app")).not.toThrow();
      expect(() => inApp(file, "file:///%")).not.toThrow();
      expect(() => inApp(file)).not.toThrow();
    });

    it("marks a frame whose file getter throws not in-app", () => {
      const frame = {
        get file(): string {
          throw new Error("boom");
        },
      };

      expect(markInApp([frame], "/app")).toEqual([{ inApp: false }]);
    });

    it("marks a missing frame not in-app", () => {
      expect(markInApp([null, undefined] as unknown as StackFrame[])).toEqual([{ inApp: false }, { inApp: false }]);
    });

    it("returns no frames for a frames value that is not an array", () => {
      expect(markInApp(null as unknown as StackFrame[])).toEqual([]);
      expect(markInApp("/app/a.js" as unknown as StackFrame[], "/app")).toEqual([]);
    });
  });
});
