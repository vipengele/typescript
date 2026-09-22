import { playwright } from "@vitest/browser-playwright";
import { configDefaults, defineConfig } from "vitest/config";

// Every package runs in both first-class runtimes. A `*.test.ts` runs under Node and in
// Chromium; a suite that only makes sense in one of them is named `*.node.test.ts` or
// `*.browser.test.ts` and runs only there. Coverage is the union of both runs, so a branch
// that only one runtime reaches is covered by that runtime's suite.
const nodeOnly = "src/**/*.node.test.ts";
const browserOnly = "src/**/*.browser.test.ts";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, browserOnly],
        },
      },
      {
        test: {
          name: "chromium",
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, nodeOnly],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
