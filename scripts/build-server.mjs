import { build } from "esbuild";

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
    "@server": path.resolve(__dirname, "src/server"),
    "@renderer": path.resolve(__dirname, "src/renderer"),
    "@shared": path.resolve(__dirname, "src/shared"),
  },
});
