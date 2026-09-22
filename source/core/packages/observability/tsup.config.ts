import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/logger/index.ts", "src/errors/index.ts"],
  format: ["esm"],
  target: "es2022",
  // `dts: true` throws against this repo's pinned typescript; `tsc -p tsconfig.build.json`
  // emits the declarations instead (see tsconfig.base.json).
  dts: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
