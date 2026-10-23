import { build } from "esbuild";
await build({
  entryPoints: ["render-worker/server.ts"],
  outfile: "render-worker/dist/server.mjs",
  platform: "node",
  format: "esm",
  target: "node24",
  bundle: true,
  packages: "external",
});
