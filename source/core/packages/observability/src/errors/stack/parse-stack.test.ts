import { describe, expect, it } from "vitest";
import { parseStack } from "./parse-stack";

// biome-ignore lint/security/noSecrets: a fixed marker string, flagged only for its entropy
const CUT = "…[truncated]";

describe("parseStack", () => {
  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["an object", { stack: "at f (/a.js:1:2)" }],
    ["an empty string", ""],
  ])("returns no frames for %s", (_, input) => {
    expect(parseStack(input)).toEqual([]);
  });

  it("returns no frames for a stack that is only a header", () => {
    expect(parseStack("Error: something broke")).toEqual([]);
  });

  describe("V8", () => {
    it("keeps engine order, so the first frame is the throw site", () => {
      const stack = [
        "TypeError: x is not a function",
        "    at inner (/app/src/inner.js:10:5)",
        "    at outer (/app/src/outer.js:20:7)",
        "    at /app/src/main.js:30:1",
      ].join("\n");

      expect(parseStack(stack)).toEqual([
        { function: "inner", file: "/app/src/inner.js", line: 10, column: 5 },
        { function: "outer", file: "/app/src/outer.js", line: 20, column: 7 },
        { file: "/app/src/main.js", line: 30, column: 1 },
      ]);
    });

    it("drops every line of a multi-line message header", () => {
      const stack = ["Error: first line", "second line of the message", "", "    at f (/a.js:1:2)"].join("\n");

      expect(parseStack(stack)).toEqual([{ function: "f", file: "/a.js", line: 1, column: 2 }]);
    });

    it("splits CRLF line endings", () => {
      expect(parseStack("Error: x\r\n    at f (/a.js:1:2)\r\n    at g (/b.js:3:4)")).toEqual([
        { function: "f", file: "/a.js", line: 1, column: 2 },
        { function: "g", file: "/b.js", line: 3, column: 4 },
      ]);
    });

    it.each<[string, string]>([
      ["at async run (/a.js:1:2)", "run"],
      ["at new Foo (/a.js:1:2)", "new Foo"],
      ["at Object.<anonymous> (/a.js:1:2)", "Object.<anonymous>"],
      ["at Foo.bar [as baz] (/a.js:1:2)", "Foo.bar [as baz]"],
    ])("reads the function of `%s`", (line, name) => {
      expect(parseStack(`Error\n    ${line}`)).toEqual([{ function: name, file: "/a.js", line: 1, column: 2 }]);
    });

    it("reads an async frame with no function", () => {
      expect(parseStack("    at async /a.js:1:2")).toEqual([{ file: "/a.js", line: 1, column: 2 }]);
    });

    it.each(["native", "<anonymous>", "index 0"])("keeps the function of a frame whose location is `%s`", (location) => {
      expect(parseStack(`    at Promise.all (${location})`)).toEqual([{ function: "Promise.all" }]);
    });

    it("keeps the function of a frame with no location", () => {
      expect(parseStack("    at <anonymous>")).toEqual([{ function: "<anonymous>" }]);
    });

    it("reads a function whose trailing parenthesis does not balance as a function", () => {
      expect(parseStack("    at weird)")).toEqual([{ function: "weird)" }]);
    });

    it("reads a location in parentheses with no function", () => {
      expect(parseStack("    at (/a.js:1:2)")).toEqual([{ file: "/a.js", line: 1, column: 2 }]);
    });

    it.each(["    at ", "    at async ", "    at (native)"])("drops `%s`, which names nothing", (line) => {
      expect(parseStack(line)).toEqual([]);
    });

    it("points an eval frame at the file that called eval", () => {
      expect(parseStack("    at eval (eval at run (/app/a.js:3:5), <anonymous>:1:1)")).toEqual([
        { function: "eval", file: "/app/a.js", line: 3, column: 5 },
      ]);
    });

    it("points a nested eval frame at the outermost calling file", () => {
      expect(parseStack("    at Object.eval (eval at a (eval at b (/app/a.js:3:5), <anonymous>:2:2), <anonymous>:1:1)")).toEqual([
        { function: "Object.eval", file: "/app/a.js", line: 3, column: 5 },
      ]);
    });

    it("keeps the function of an eval frame whose origin has no location", () => {
      expect(parseStack("    at eval (eval at run, <anonymous>:1:1)")).toEqual([{ function: "eval" }]);
    });

    it.each<[string, string]>([
      ["C:\\app\\x.js:1:2", "C:\\app\\x.js"],
      ["file:///C:/app/x.js:1:2", "file:///C:/app/x.js"],
      ["node:internal/modules/cjs/loader:1:2", "node:internal/modules/cjs/loader"],
      ["webpack-internal:///./src/x.js:1:2", "webpack-internal:///./src/x.js"],
      ["http://localhost:5173/src/x.js:1:2", "http://localhost:5173/src/x.js"],
      ["data:text/javascript,throw new Error(1):1:2", "data:text/javascript,throw new Error(1)"],
    ])("keeps the scheme or drive of `%s` inside the file", (location, file) => {
      expect(parseStack(`    at f (${location})`)).toEqual([{ function: "f", file, line: 1, column: 2 }]);
      expect(parseStack(`    at ${location}`)).toEqual([{ file, line: 1, column: 2 }]);
    });

    it("reads a location with a line and no column", () => {
      expect(parseStack("    at f (/a.js:7)")).toEqual([{ function: "f", file: "/a.js", line: 7 }]);
    });

    it("keeps a Windows path with no line as part of the function", () => {
      expect(parseStack("    at C:\\app\\x.js")).toEqual([{ function: "C:\\app\\x.js" }]);
    });
  });

  describe("SpiderMonkey", () => {
    it("reads named and anonymous frames", () => {
      const stack = ["inner@http://localhost/a.js:10:5", "outer/<@http://localhost/b.js:20:7", "@http://localhost/c.js:30:1", ""].join(
        "\n",
      );

      expect(parseStack(stack)).toEqual([
        { function: "inner", file: "http://localhost/a.js", line: 10, column: 5 },
        { function: "outer/<", file: "http://localhost/b.js", line: 20, column: 7 },
        { file: "http://localhost/c.js", line: 30, column: 1 },
      ]);
    });

    it("keeps an `@` in the file inside the file", () => {
      expect(parseStack("run@/app/node_modules/@scope/pkg/index.js:1:2")).toEqual([
        { function: "run", file: "/app/node_modules/@scope/pkg/index.js", line: 1, column: 2 },
      ]);
    });

    it.each(["line 4 > eval:1:5", "line 4 > Function:1:5", "line 4 > eval line 1 > eval:1:5"])(
      "points an eval frame (`%s`) at the file and line that called it",
      (suffix) => {
        expect(parseStack(`run@http://localhost/a.js ${suffix}`)).toEqual([{ function: "run", file: "http://localhost/a.js", line: 4 }]);
      },
    );

    it("drops an eval frame with no file", () => {
      expect(parseStack("run@  line 4 > eval:1:5")).toEqual([]);
    });
  });

  describe("JavaScriptCore", () => {
    it("drops `[native code]` frames and keeps the rest", () => {
      const stack = [
        "inner@http://localhost/a.js:10:5",
        "forEach@[native code]",
        "[native code]",
        "global code@http://localhost/b.js:2:3",
      ].join("\n");

      expect(parseStack(stack)).toEqual([
        { function: "inner", file: "http://localhost/a.js", line: 10, column: 5 },
        { function: "global code", file: "http://localhost/b.js", line: 2, column: 3 },
      ]);
    });

    it("reads a frame with no column", () => {
      expect(parseStack("eval code@http://localhost/a.js:4")).toEqual([{ function: "eval code", file: "http://localhost/a.js", line: 4 }]);
    });

    it("drops a header line whose message carries an `@`", () => {
      expect(parseStack("Error: mail user@example.com failed\n@http://localhost/a.js:1:2")).toEqual([
        { file: "http://localhost/a.js", line: 1, column: 2 },
      ]);
    });
  });

  describe("truncated stacks", () => {
    it("drops the line the truncation marker ends, never reading it as a file", () => {
      const stack = `Error: x\n    at f (/a.js:1:2)\n    at g (/app/b.js:12${CUT}`;

      expect(parseStack(stack)).toEqual([{ function: "f", file: "/a.js", line: 1, column: 2 }]);
    });

    it("drops a truncated location-only frame", () => {
      expect(parseStack(`    at f (/a.js:1:2)\n    at /app/b.js:1${CUT}`)).toEqual([{ function: "f", file: "/a.js", line: 1, column: 2 }]);
    });
  });

  it("drops a line number too large to be a safe integer", () => {
    expect(parseStack("@/a.js:99999999999999999999:1")).toEqual([]);
  });

  it("drops a column too large to be a safe integer and keeps the line", () => {
    expect(parseStack("@/a.js:3:99999999999999999999")).toEqual([{ file: "/a.js", line: 3 }]);
  });

  it("drops lines that are neither frames nor `@` frames", () => {
    expect(parseStack("just some text\n  \n    at f (/a.js:1:2)")).toEqual([{ function: "f", file: "/a.js", line: 1, column: 2 }]);
  });
});
