import { describe, expect, it } from "vitest";
import manifest from "../package.json";

// `vite` is not a direct dependency, so `import.meta.glob` is typed by the one call shape this
// file uses. Vite rewrites the literal `import.meta.glob(` call into the config's inlined source
// in both runtimes.
type GlobMeta = {
  glob(pattern: string, options: { query: string; import: string; eager: true }): Record<string, string>;
};
const [tsupConfig = ""] = Object.values(
  (import.meta as ImportMeta & GlobMeta).glob("../tsup.config.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);

const entryPattern = /"src\/(.+)\/index\.ts"/g;

const subPathOf = (key: string): string => key.slice("./".length);

const exportEntries = Object.entries(manifest.exports).filter(([key]) => key !== "." && key !== "./package.json");
const exportSubPaths = exportEntries.map(([key]) => subPathOf(key));
const tsupSubPaths = [...tsupConfig.matchAll(entryPattern)].map((match) => match[1]);

describe("package exports and tsup entries", () => {
  it("reads at least one sub-path entry from each side", () => {
    expect(exportSubPaths.length).toBeGreaterThan(0);
    expect(tsupSubPaths.length).toBeGreaterThan(0);
  });

  it("builds a tsup entry for every exports sub-path", () => {
    expect([...tsupSubPaths].sort()).toEqual(expect.arrayContaining([...exportSubPaths].sort()));
  });

  it("exports every tsup sub-path entry", () => {
    expect([...exportSubPaths].sort()).toEqual(expect.arrayContaining([...tsupSubPaths].sort()));
  });

  it("builds the root entry", () => {
    expect(tsupConfig).toContain('"src/index.ts"');
  });

  it.each(exportEntries)("%s points types and default at its own dist directory", (key, target) => {
    const subPath = subPathOf(key);
    expect(target).toEqual({
      types: `./dist/${subPath}/index.d.ts`,
      default: `./dist/${subPath}/index.js`,
    });
  });
});
