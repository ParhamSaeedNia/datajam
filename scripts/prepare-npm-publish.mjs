import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sdkDir = join(root, "packages/sdk");
const dashboardDir = join(root, "packages/dashboard");
const publishDir = join(sdkDir, "npm");
const dashboardAppDir = join(publishDir, "dashboard-app");

const publishedDependencies = {
  "better-sqlite3": "^11.7.0",
  commander: "^12.1.0",
  jiti: "^2.4.2",
  next: "^15.1.0",
  react: "^19.0.0",
  "react-dom": "^19.0.0",
  recharts: "^2.13.3",
  stripe: "^17.5.0"
};

console.log("Building workspace packages...");
execSync("pnpm build", { cwd: root, stdio: "inherit" });
console.log("Building dashboard app...");
execSync("pnpm --filter @datajam/dashboard build", { cwd: root, stdio: "inherit" });

console.log("Preparing publish directory...");
await rm(publishDir, { recursive: true, force: true });
await mkdir(publishDir, { recursive: true });
await mkdir(dashboardAppDir, { recursive: true });

console.log("Bundling publishable SDK...");
execSync("pnpm exec tsup --config tsup.publish.config.ts", { cwd: sdkDir, stdio: "inherit" });

for (const item of ["app", ".next", "next.config.mjs", "tailwind.config.ts", "postcss.config.mjs"]) {
  await cp(join(dashboardDir, item), join(dashboardAppDir, item), { recursive: true });
}
await rm(join(dashboardAppDir, ".next", "cache"), { recursive: true, force: true });
for (const item of ["standalone", "trace", "types"]) {
  await rm(join(dashboardAppDir, ".next", item), { recursive: true, force: true });
}

const sourcePackage = JSON.parse(await readFile(join(sdkDir, "package.json"), "utf8"));
const publishPackage = {
  name: sourcePackage.name,
  version: sourcePackage.version,
  description: sourcePackage.description,
  license: sourcePackage.license,
  type: "module",
  main: "dist/index.js",
  types: "dist/index.d.ts",
  bin: {
    datajam: "dist/bin.js"
  },
  files: ["dist", "dashboard-app"],
  exports: {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js"
    }
  },
  engines: {
    node: ">=20"
  },
  keywords: ["stripe", "analytics", "sqlite", "sdk", "dashboard", "local-first"],
  repository: sourcePackage.repository,
  dependencies: publishedDependencies
};

await writeFile(join(publishDir, "package.json"), `${JSON.stringify(publishPackage, null, 2)}\n`, "utf8");

console.log(`\nPublish staging ready at: ${publishDir}`);
console.log("Next steps:");
console.log(`  cd ${publishDir}`);
console.log("  npm pack");
console.log("  npm publish --access public");
