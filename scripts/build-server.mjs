import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

await build({
  entryPoints: [
    "src/server/index.ts",
    "src/server/mcp/teamMcpStdio.ts",
    "src/electron/main.ts",
  ],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outdir: "dist-server",
  packages: "external",
  sourcemap: true,
  alias: {
    "@server": path.resolve(projectRoot, "src/server"),
    "@renderer": path.resolve(projectRoot, "src/renderer"),
    "@shared": path.resolve(projectRoot, "src/shared"),
  },
});
