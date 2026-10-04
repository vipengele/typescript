import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/types/numeric/index.ts",
    "src/types/date-time/index.ts",
    "src/context/index.ts",
    "src/attributes/index.ts",
    "src/serialization/index.ts",
    "src/scope/index.ts",
    "src/runtime/index.ts",
    "src/locale/index.ts",
  ],
  format: ["esm"],
  target: "es2022",
  // `dts: true` throws against this repo's pinned typescript; `tsc -p tsconfig.build.json`
  // emits the declarations instead (see tsconfig.base.json).
  dts: false,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
