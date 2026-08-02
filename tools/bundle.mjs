import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

await build({
  absWorkingDir: projectRoot,
  entryPoints: [join(projectRoot, "BP/scripts/main.js")],
  outfile: join(projectRoot, "dist/scripts/main.js"),
  bundle: true,
  format: "esm",
  target: "es2020",
  logLevel: "warning",
  preserveSymlinks: true,
  alias: {
    DoriosCore: join(projectRoot, "BP/scripts/DoriosCore"),
    DoriosLib: join(projectRoot, "BP/scripts/DoriosLib"),
    config: join(projectRoot, "BP/scripts/config"),
    machinery: join(projectRoot, "BP/scripts/machinery"),
  },
  external: [
    "@minecraft/server",
    "@minecraft/server-ui",
    "@minecraft/server-*",
    "@minecraft/common",
    "@minecraft/debug-utilities",
  ],
});

console.log("Bundled BP/scripts/main.js -> dist/scripts/main.js");
