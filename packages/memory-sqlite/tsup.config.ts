import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // better-sqlite3 is a native CJS module — bundle it rather than leaving as external
  noExternal: ["better-sqlite3"],
});
