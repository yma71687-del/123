import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  readdir,
  stat,
  statfs,
  realpath,
  rm,
  chmod,
} from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { bundle } from "@remotion/bundler";
import {
  renderMedia,
  selectComposition,
  makeCancelSignal,
} from "@remotion/renderer";
import {
  adSchema,
  defaultAd,
  renderRequestSchema,
  type AdProject,
} from "../video/schema";

const ROOT = resolve(process.env.NEXUS_ROOT || process.cwd());
const DATA = resolve(process.env.AD_DATA_DIR || join(ROOT, ".ad-data"));
const ASSETS = resolve(
  process.env.NEXUS_ASSET_DIR || join(ROOT, ".local-data/assets"),
);
const PORT = Number(process.env.AD_PORT || 43141);
const HOST = process.env.AD_HOST || "127.0.0.1";
const browserExecutable = process.env.CHROME_EXECUTABLE || "/usr/bin/chromium";
const JOBS = join(DATA, "jobs"),
  PROJECT = join(DATA, "project.json");
const idPattern = /^[a-f0-9]{32}$/;
type Job = {
  id: string;
  name: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: number;
  format: "mp4" | "webm-alpha" | "prores";
  resolution: "720p" | "1080p";
  createdAt: string;
  error?: string;
  project: AdProject;
  elapsedSeconds?: number;
};
const jobs = new Map<string, Job>();
const cancelers = new Map<string, () => void>();
const writes = new Map<string, Promise<void>>();
let active: string | null = null;
let cachedBundle: Promise<string> | null = null;

await mkdir(JOBS, { recursive: true, mode: 0o700 });
async function atomic(path: string, value: unknown) {
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
function persist(job: Job) {
  const next = (writes.get(job.id) || Promise.resolve())
    .catch(() => {})
    .then(() => atomic(join(JOBS, job.id + ".json"), job));
  writes.set(job.id, next);
  return next;
}
function cancelled(job: Job) {
  return job.status === "cancelled";
}
function extension(job: Job) {
  return job.format === "mp4"
    ? ".mp4"
    : job.format === "prores"
      ? ".mov"
      : ".webm";
}
function output(job: Job) {
  return join(JOBS, job.id + extension(job));
}
function publicJob(job: Job) {
  const { project, ...rest } = job;
  return {
    ...rest,
    downloadUrl:
      job.status === "done"
        ? "/api/advertising/jobs/" + job.id + "/file"
        : null,
  };
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 128 * 1024)
      throw Object.assign(new Error("请求超过 128 KB"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw Object.assign(new Error("无效的 JSON"), { status: 400 });
  }
}
async function asset(id: string, kind?: "image" | "audio") {
  if (!idPattern.test(id)) throw new Error("无效素材编号");
  const filenames = await readdir(ASSETS);
  const name = filenames.find(
    (name) =>
      name.startsWith(id + ".") && /^[a-f0-9]{32}\.[a-z0-9]{1,12}$/.test(name),
  );
  if (!name) throw new Error("素材不存在：" + id);
  const path = join(ASSETS, name);
  if ((await realpath(path)) !== path || !(await stat(path)).isFile())
    throw new Error("素材路径无效");
  const meta = JSON.parse(
    await readFile(join(ASSETS, ".metadata", id + ".json"), "utf8"),
  );
  const type = String(meta.contentType);
  if (
    ![
      "image/png",
      "image/jpeg",
      "image/webp",
      "audio/wav",
      "audio/x-wav",
      "audio/mpeg",
      "audio/ogg",
      "audio/mp4",
      "audio/flac",
      "audio/aac",
    ].includes(type)
  )
    throw new Error("广告动效只支持 PNG/JPEG/WebP 图片及标准音频");
  if (kind && !type.startsWith(kind + "/")) throw new Error("素材类型不符");
  return { path, type };
}
for (const filename of await readdir(JOBS)) {
  if (!/^[a-f0-9]{32}\.json$/.test(filename)) continue;
  try {
    const job = JSON.parse(await readFile(join(JOBS, filename), "utf8")) as Job;
    if (!idPattern.test(job.id) || filename !== job.id + ".json") continue;
    adSchema.parse(job.project);
    if (job.status === "running" || job.status === "queued") {
      job.status = "failed";
      job.error = "服务重启中断了上次任务，请重新提交";
      await persist(job);
    }
    jobs.set(job.id, job);
  } catch {
    console.error("忽略损坏的任务记录：" + filename);
  }
}

async function pump() {
  if (active) return;
  const job = [...jobs.values()].find((j) => j.status === "queued");
  if (!job) return;
  active = job.id;
  const started = Date.now();
  const { cancel, cancelSignal } = makeCancelSignal();
  cancelers.set(job.id, cancel);
  const timer = setTimeout(() => {
    job.error = "渲染超过 180 秒资源上限";
    cancel();
  }, 180000);
  try {
    job.status = "running";
    await persist(job);
    cachedBundle ??= bundle({
      entryPoint: join(ROOT, "video/index.ts"),
      publicDir: join(ROOT, "frontend/public"),
      outDir: join(DATA, "bundle"),
      enableCaching: true,
    }).catch((error) => {
      cachedBundle = null;
      throw error;
    });
    const serveUrl = await cachedBundle;
    if (cancelled(job)) return;
    const inputProps = {
      project: job.project,
      resolution: job.resolution,
      transparent: job.format !== "mp4",
      assetBase: `http://127.0.0.1:${PORT}/api/advertising/assets/`,
    };
    const composition = await selectComposition({
      serveUrl,
      id: "NexusAd",
      inputProps,
      browserExecutable,
      chromiumOptions: { disableWebSecurity: false },
    });
    if (cancelled(job)) return;
    let last = 0;
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      outputLocation: output(job),
      browserExecutable,
      codec:
        job.format === "mp4"
          ? "h264"
          : job.format === "prores"
            ? "prores"
            : "vp9",
      imageFormat: job.format === "mp4" ? "jpeg" : "png",
      pixelFormat:
        job.format === "mp4"
          ? "yuv420p"
          : job.format === "prores"
            ? "yuva444p10le"
            : "yuva420p",
      ...(job.format === "prores" ? { proResProfile: "4444" as const } : {}),
      concurrency: 1,
      muted: false,
      enforceAudioTrack: true,
      overwrite: true,
      cancelSignal,
      onProgress: ({ progress }) => {
        job.progress = progress;
        if (Date.now() - last > 700) {
          last = Date.now();
          persist(job).catch(() => {});
        }
      },
    });
    if (!cancelled(job)) {
      if ((await stat(output(job))).size < 1000)
        throw new Error("渲染未生成有效视频");
      await chmod(output(job), 0o600);
      job.status = "done";
      job.progress = 1;
      job.elapsedSeconds = (Date.now() - started) / 1000;
    }
  } catch (error) {
    if (job.status !== "cancelled") {
      job.status = "failed";
      job.error =
        job.error || (error instanceof Error ? error.message : "渲染失败");
    }
  } finally {
    clearTimeout(timer);
    cancelers.delete(job.id);
    if (job.status !== "done") await rm(output(job), { force: true });
    await persist(job);
    active = null;
    setImmediate(() => void pump());
  }
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url || "/", `http://127.0.0.1:${PORT}`).pathname;
  const method = req.method;
  try {
    if (path === "/api/advertising/health" && method === "GET")
      return json(res, 200, {
        ok: true,
        service: "nexus-ad-renderer",
        version: "0.5.0",
        remotion: "4.0.538",
        active,
        queued: [...jobs.values()].filter((j) => j.status === "queued").length,
        limits: {
          concurrency: 1,
          maxQueued: 3,
          maxSeconds: 30,
          timeoutSeconds: 180,
        },
      });
    if (path === "/api/advertising/project" && method === "GET") {
      try {
        return json(res, 200, {
          project: adSchema.parse(JSON.parse(await readFile(PROJECT, "utf8"))),
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return json(res, 200, { project: defaultAd });
        throw Object.assign(
          new Error("已有广告工程无法读取，已保留文件；请使用本地导出备份恢复"),
          { status: 409 },
        );
      }
    }
    if (path === "/api/advertising/project" && method === "PUT") {
      const parsed = adSchema.safeParse((await body(req)).project);
      if (!parsed.success)
        return json(res, 422, {
          detail: parsed.error.issues.map((i) => i.message).join("；"),
        });
      try {
        adSchema.parse(JSON.parse(await readFile(PROJECT, "utf8")));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          return json(res, 409, {
            detail: "已有工程损坏，拒绝覆盖；请先保留原文件并恢复备份",
          });
      }
      await atomic(PROJECT, parsed.data);
      return json(res, 200, { saved: true });
    }
    if (path === "/api/advertising/jobs" && method === "GET")
      return json(res, 200, {
        jobs: [...jobs.values()].reverse().slice(0, 50).map(publicJob),
      });
    if (path === "/api/advertising/jobs" && method === "POST") {
      const parsed = renderRequestSchema.safeParse(await body(req));
      if (!parsed.success)
        return json(res, 422, {
          detail: parsed.error.issues.map((i) => i.message).join("；"),
        });
      if ([...jobs.values()].filter((j) => j.status === "queued").length >= 3)
        return json(res, 429, { detail: "队列已满，请等待或取消任务" });
      if (jobs.size >= 50)
        return json(res, 429, {
          detail: "任务历史已达 50 条，请删除不需要的已完成任务",
        });
      const disk = await statfs(DATA);
      if (disk.bavail * disk.bsize < 1024 ** 3)
        return json(res, 507, {
          detail: "可用磁盘不足 1 GB，暂停新渲染以保护已有业务",
        });
      let used = 0;
      for (const j of jobs.values()) {
        try {
          used += (await stat(output(j))).size;
        } catch {
          /* No output yet. */
        }
      }
      if (used > 1024 ** 3)
        return json(res, 507, {
          detail: "广告导出已占用超过 1 GB，请先删除不需要的历史任务",
        });
      const request = parsed.data;
      for (const id of request.project.imageAssetIds) await asset(id, "image");
      if (request.project.music.assetId)
        await asset(request.project.music.assetId, "audio");
      const job: Job = {
        id: randomUUID().replaceAll("-", ""),
        name: request.project.name,
        status: "queued",
        progress: 0,
        format: request.format,
        resolution: request.resolution,
        createdAt: new Date().toISOString(),
        project: request.project,
      };
      jobs.set(job.id, job);
      await persist(job);
      json(res, 202, publicJob(job));
      void pump();
      return;
    }
    const match = path.match(
      /^\/api\/advertising\/jobs\/([a-f0-9]{32})(\/file)?$/,
    );
    if (match) {
      const job = jobs.get(match[1]);
      if (!job) return json(res, 404, { detail: "任务不存在" });
      if (match[2] && method === "GET") {
        if (job.status !== "done")
          return json(res, 409, { detail: "视频尚未完成" });
        res.writeHead(200, {
          "Content-Type":
            job.format === "mp4"
              ? "video/mp4"
              : job.format === "prores"
                ? "video/quicktime"
                : "video/webm",
          "Content-Length": (await stat(output(job))).size,
          "Content-Disposition": `attachment; filename="nexus-ad-${job.id}${extension(job)}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        });
        createReadStream(output(job)).pipe(res);
        return;
      }
      if (!match[2] && method === "GET") return json(res, 200, publicJob(job));
      if (!match[2] && method === "DELETE") {
        if (job.status === "queued" || active === job.id) {
          job.status = "cancelled";
          cancelers.get(job.id)?.();
          await persist(job);
          return json(res, 202, publicJob(job));
        }
        await rm(output(job), { force: true });
        await rm(join(JOBS, job.id + ".json"), { force: true });
        jobs.delete(job.id);
        return json(res, 200, { deleted: true });
      }
    }
    const media = path.match(/^\/api\/advertising\/assets\/([a-f0-9]{32})$/);
    if (media && method === "GET") {
      const found = await asset(media[1]);
      res.writeHead(200, {
        "Content-Type": found.type,
        "Content-Length": (await stat(found.path)).size,
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
      });
      createReadStream(found.path).pipe(res);
      return;
    }
    return json(res, 404, { detail: "接口不存在" });
  } catch (error) {
    if (!res.headersSent)
      json(res, (error as { status?: number }).status || 400, {
        detail: error instanceof Error ? error.message : "请求失败",
      });
    else res.destroy();
  }
});
server.listen(PORT, HOST, () =>
  console.log(`NEXUS ad render service: http://${HOST}:${PORT}`),
);
async function shutdown() {
  for (const [id, cancel] of cancelers) {
    jobs.get(id)!.status = "cancelled";
    cancel();
  }
  server.close();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
