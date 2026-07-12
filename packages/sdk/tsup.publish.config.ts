import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts", "src/browser.ts"],
  format: ["esm"],
  dts: true,
  bundle: true,
  splitting: true,
  clean: true,
  outDir: "npm/dist",
  external: ["better-sqlite3", "stripe", "next", "react", "react-dom", "commander", "recharts", "jiti"],
  noExternal: [/@datajam\/.*/]
});
