/** Render library covers from the real composition; synthetic material only. */
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { defaultAd } from "../video/schema";
const temporary = await mkdtemp(join(tmpdir(), "nexus-effect-covers-"));
const output = resolve("frontend/public/effects");
const browserExecutable = process.env.CHROME_EXECUTABLE || "/usr/bin/chromium";
await mkdir(output, { recursive: true });
try {
  const serveUrl = await bundle({ entryPoint: resolve("video/index.ts"), publicDir: resolve("frontend/public"), outDir: join(temporary, "bundle") });
  const records = [];
  for (const template of ["showcase", "cloud", "hud", "grid"] as const) {
    const inputProps = { project: { ...structuredClone(defaultAd), template, music: { ...defaultAd.music, enabled: false }, sfx: [] }, assetBase: "/api/assets/", resolution: "1080p", transparent: false };
    const composition = await selectComposition({ serveUrl, id: "NexusAd", inputProps, browserExecutable });
    const file = join(output, template + ".jpg");
    await renderStill({ serveUrl, composition, inputProps, browserExecutable, output: file, frame: 60, imageFormat: "jpeg", jpegQuality: 90, scale: 1 / 3, logLevel: "error" });
    await chmod(file, 0o644);
    records.push({ template, frame: 60, width: 640, height: 360, sha256: createHash("sha256").update(await readFile(file)).digest("hex"), project: inputProps.project });
    process.stdout.write("Rendered real effect cover: " + template + "\n");
  }
  await writeFile(join(output, "manifest.json"), JSON.stringify({ source: "video/AdFilm.tsx", fps: 30, records }, null, 2) + "\n");
  await chmod(join(output, "manifest.json"), 0o644);
} finally { await rm(temporary, { recursive: true, force: true }); }
